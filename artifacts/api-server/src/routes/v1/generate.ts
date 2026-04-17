import { Router, type IRouter } from "express";
import { db, usageLogsTable } from "@workspace/db";
import { GenerateContentBody } from "@workspace/api-zod";
import { requireApiKey } from "../../middlewares/apiKeyAuth";
import { checkRateLimit } from "../../lib/rateLimit";
import { generateImageWithImagen, normalizeToPlanModelId } from "../../lib/vertexai";
import { calculateImageCost } from "../../lib/billing";
import { generateRequestId } from "../../lib/crypto";
import { dispatchWebhooks } from "../../lib/webhookDispatcher";
import { deductAndLog, isModelInPlan } from "../../lib/chatUtils";

const router: IRouter = Router();

router.post("/v1/generate", requireApiKey, async (req, res): Promise<void> => {
  // Coerce common string-typed numeric inputs (n8n, form-data clients send numbers as strings)
  if (req.body && typeof req.body === "object") {
    if (typeof req.body.sampleCount === "string" && req.body.sampleCount.trim() !== "") {
      const n = Number(req.body.sampleCount);
      if (!Number.isNaN(n)) req.body.sampleCount = n;
    }
  }
  const parsed = GenerateContentBody.safeParse(req.body);
  if (!parsed.success) {
    const errMsg = parsed.error.message;
    const requestId = req.preassignedRequestId ?? generateRequestId();
    await db.insert(usageLogsTable).values({
      apiKeyId: req.apiKey!.id,
      model: String(req.body?.model ?? "unknown"),
      inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0,
      requestId, status: "rejected", errorMessage: `Validation error: ${errMsg}`,
    });
    res.status(400).json({ error: errMsg });
    return;
  }

  const { model: rawModel = "imagen-3.0-generate-002", prompt, sampleCount = 1 } = parsed.data;
  const model = rawModel.toLowerCase().trim();
  const apiKey = req.apiKey!;
  const requestId = req.preassignedRequestId ?? generateRequestId();

  // Accept Imagen models AND OpenAI-compatible image aliases (dall-e-2, dall-e-3, gpt-image-1).
  // The aliases are resolved to imagen-* by generateImageWithImagen via GEMINI_ALIASES.
  const isOpenAIImageAlias = model === "dall-e-2" || model === "dall-e-3" || model === "gpt-image-1";
  if (!model.startsWith("imagen-") && !isOpenAIImageAlias) {
    res.status(400).json({
      error: `Model "${model}" is not supported on this endpoint. ` +
        `Accepted: Imagen models (imagen-*) and OpenAI-compatible aliases (dall-e-2, dall-e-3, gpt-image-1). ` +
        `Use POST /v1/chat for text models or POST /v1/video for Veo video models.`,
    });
    return;
  }

  const allowed = apiKey.plan.modelsAllowed;
  const planModel = normalizeToPlanModelId(model);
  const modelInPlan = isModelInPlan(allowed, planModel);
  if (!modelInPlan && apiKey.topupCredit <= 0) {
    const errMsg =
      `Model "${model}" is not in your plan ("${apiKey.plan.name}"). ` +
      `Use top-up credit or upgrade your plan. Plan models: ${allowed.join(", ")}`;
    await db.insert(usageLogsTable).values({
      apiKeyId: apiKey.id, model, inputTokens: 0, outputTokens: 0,
      totalTokens: 0, costUsd: 0, requestId, status: "rejected", errorMessage: errMsg,
    });
    res.status(403).json({ error: errMsg });
    return;
  }

  const _rpm = apiKey.rpmLimit ?? apiKey.plan.rpm;
  const _bucket = apiKey.rpmLimit ? -apiKey.id : apiKey.userId;
  const withinLimit = await checkRateLimit(_bucket, _rpm, "generate");
  if (!withinLimit) {
    const errMsg = `Rate limit exceeded. Your account allows ${apiKey.plan.rpm} requests per minute (shared across all your API keys).`;
    await db.insert(usageLogsTable).values({
      apiKeyId: apiKey.id, model, inputTokens: 0, outputTokens: 0,
      totalTokens: 0, costUsd: 0, requestId, status: "rejected", errorMessage: errMsg,
    });
    res.status(429).json({ error: errMsg });
    return;
  }

  const costUsd = calculateImageCost(planModel, sampleCount);
  const availableForThisModel = modelInPlan ? apiKey.accountCreditBalance : apiKey.topupCredit;

  if (availableForThisModel < costUsd) {
    const errMsg = modelInPlan
      ? "Insufficient credits for this request."
      : `Insufficient top-up credit for out-of-plan model "${model}".`;
    await db.insert(usageLogsTable).values({
      apiKeyId: apiKey.id, model, inputTokens: 0, outputTokens: 0,
      totalTokens: 0, costUsd: 0, requestId, status: "rejected", errorMessage: errMsg,
    });
    res.status(402).json({ error: errMsg });
    return;
  }

  let result;
  try {
    result = await generateImageWithImagen(model, prompt, sampleCount);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    await db.insert(usageLogsTable).values({
      apiKeyId: apiKey.id, model, inputTokens: 0, outputTokens: 0,
      totalTokens: 0, costUsd: 0, requestId, status: "error", errorMessage,
    });
    res.status(502).json({ error: `Imagen API error: ${errorMessage}` });
    return;
  }

  // Atomically deduct + log via the unified billing helper. This routes the
  // debit to the correct target (user OR organization) based on
  // apiKey.billingTarget, mirroring the pattern used in /v1/chat, /v1/audio,
  // /v1/embeddings, /v1/images/edits, and /v1/responses.
  const sufficient = await deductAndLog(
    apiKey.billingTarget, apiKey.id, model, requestId, 0, sampleCount, costUsd, { modelInPlan },
  );

  if (!sufficient) {
    res.status(402).json({ error: "Insufficient credits to complete this request." });
    return;
  }

  void dispatchWebhooks(apiKey.userId, "usage.success", {
    model,
    requestId,
    imageCount: sampleCount,
    costUsd,
  });

  res.json({
    id: requestId,
    model,
    images: result.images,
    costUsd,
  });
});

export default router;
