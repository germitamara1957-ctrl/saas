import { Router, type IRouter } from "express";
import multer from "multer";
import { db, usageLogsTable } from "@workspace/db";
import { requireApiKey } from "../../middlewares/apiKeyAuth";
import { checkRateLimit } from "../../lib/rateLimit";
import { generateImageWithImagen, normalizeToPlanModelId } from "../../lib/vertexai";
import { calculateImageCost } from "../../lib/billing";
import { generateRequestId } from "../../lib/crypto";
import { dispatchWebhooks } from "../../lib/webhookDispatcher";
import { deductAndLog, isModelInPlan } from "../../lib/chatUtils";

const router: IRouter = Router();

// OpenAI's POST /v1/images/generations supports both JSON and multipart/form-data.
// n8n's OpenAI Image node, openai-python and openai-node may send either.
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, fields: 32 },
});

function imageBodyParser(req: import("express").Request, res: import("express").Response, next: import("express").NextFunction): void {
  const ct = String(req.headers["content-type"] ?? "").toLowerCase();
  if (ct.startsWith("multipart/form-data")) {
    imageUpload.any()(req, res, next);
    return;
  }
  next();
}

// ─── OpenAI Image-compatible aliases (mapped to Imagen backend) ───────────────
// Worst → worst, best → best to preserve user expectations.
const OPENAI_TO_IMAGEN: Record<string, string> = {
  "dall-e-2":    "imagen-3.0-fast-generate-001",
  "dall-e-3":    "imagen-4.0-generate-001",
  "gpt-image-1": "imagen-4.0-ultra-generate-001",
};

function mapModel(model: string | undefined): string {
  if (!model) return "imagen-3.0-fast-generate-001";
  const lower = model.toLowerCase().trim();
  return OPENAI_TO_IMAGEN[lower] ?? lower;
}

function reverseMapModel(imagenModel: string): string {
  for (const [openai, imagen] of Object.entries(OPENAI_TO_IMAGEN)) {
    if (imagen === imagenModel) return openai;
  }
  return imagenModel;
}

function parseN(input: unknown): number {
  if (input === undefined || input === null || input === "") return 1;
  if (typeof input === "number" && Number.isFinite(input)) return Math.max(1, Math.min(8, Math.trunc(input)));
  if (typeof input === "string") {
    const n = Number(input.trim());
    if (Number.isFinite(n)) return Math.max(1, Math.min(8, Math.trunc(n)));
  }
  return 1;
}

// ─── POST /v1/images/generations — OpenAI-shaped image generation ────────────
router.post("/v1/images/generations", imageBodyParser, requireApiKey, async (req, res): Promise<void> => {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const requestedModel = (typeof body.model === "string" ? body.model : "dall-e-2").toLowerCase().trim();

  // Strict model gate — accept only Imagen models or the 3 OpenAI image aliases.
  // Matches /v1/generate validation; fail fast with 400 instead of 502 from backend.
  const isAlias = requestedModel in OPENAI_TO_IMAGEN;
  if (!requestedModel.startsWith("imagen-") && !isAlias) {
    res.status(400).json({
      error: {
        message:
          `Model "${requestedModel}" is not supported on this endpoint. ` +
          `Accepted: Imagen models (imagen-*) and OpenAI-compatible aliases (dall-e-2, dall-e-3, gpt-image-1).`,
        type: "invalid_request_error",
        code: "model_not_supported",
      },
    });
    return;
  }

  const imagenModel = mapModel(requestedModel);
  const aliasLabel = reverseMapModel(imagenModel);

  // Transparency FIRST — set on every response, including early validation errors.
  res.setHeader("X-Backend-Model", imagenModel);

  const apiKey = req.apiKey!;
  const requestId = req.preassignedRequestId ?? generateRequestId();

  const prompt = typeof body.prompt === "string" ? body.prompt : "";
  if (!prompt) {
    await db.insert(usageLogsTable).values({
      apiKeyId: apiKey.id,
      model: aliasLabel,
      inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0,
      requestId, status: "rejected", errorMessage: "prompt is required",
    });
    res.status(400).json({
      error: { message: "prompt is required", type: "invalid_request_error", code: "missing_prompt" },
    });
    return;
  }

  const n = parseN(body.n);

  // Plan / credit check — same split-balance logic and same normalization as /v1/generate.
  // normalizeToPlanModelId resolves aliases (e.g. dall-e-3 → imagen-4.0-generate-001) before
  // the plan lookup, so plan membership is checked against the canonical backend model.
  const allowed = apiKey.plan.modelsAllowed;
  const planModel = normalizeToPlanModelId(requestedModel);
  const modelInPlan = isModelInPlan(allowed, planModel);

  if (!modelInPlan && apiKey.topupCredit <= 0) {
    const errMsg =
      `Model "${aliasLabel}" (powered by ${imagenModel}) is not in your plan ("${apiKey.plan.name}"). ` +
      `Use top-up credit or upgrade your plan. Plan models: ${allowed.join(", ")}`;
    await db.insert(usageLogsTable).values({
      apiKeyId: apiKey.id, model: aliasLabel, inputTokens: 0, outputTokens: 0,
      totalTokens: 0, costUsd: 0, requestId, status: "rejected", errorMessage: errMsg,
    });
    res.status(403).json({
      error: { message: errMsg, type: "model_not_allowed" },
    });
    return;
  }

  const _rpm = apiKey.rpmLimit ?? apiKey.plan.rpm;
  const _bucket = apiKey.rpmLimit ? -apiKey.id : apiKey.userId;
  const withinLimit = await checkRateLimit(_bucket, _rpm, "generate");
  if (!withinLimit) {
    const errMsg = `Rate limit exceeded. Your account allows ${apiKey.plan.rpm} requests per minute (shared across all your API keys).`;
    await db.insert(usageLogsTable).values({
      apiKeyId: apiKey.id, model: aliasLabel, inputTokens: 0, outputTokens: 0,
      totalTokens: 0, costUsd: 0, requestId, status: "rejected", errorMessage: errMsg,
    });
    res.status(429).json({
      error: { message: errMsg, type: "rate_limit_exceeded" },
    });
    return;
  }

  // Bill against the alias (so the user sees the price they expect for "dall-e-3")
  const costUsd = calculateImageCost(aliasLabel, n);
  const availableForThisModel = modelInPlan ? apiKey.accountCreditBalance : apiKey.topupCredit;

  if (availableForThisModel < costUsd) {
    const errMsg = modelInPlan
      ? "Insufficient credits for this request."
      : `Insufficient top-up credit for out-of-plan model "${aliasLabel}".`;
    await db.insert(usageLogsTable).values({
      apiKeyId: apiKey.id, model: aliasLabel, inputTokens: 0, outputTokens: 0,
      totalTokens: 0, costUsd: 0, requestId, status: "rejected", errorMessage: errMsg,
    });
    res.status(402).json({
      error: { message: errMsg, type: "insufficient_credit" },
    });
    return;
  }

  let result;
  try {
    result = await generateImageWithImagen(imagenModel, prompt, n);
  } catch (err) {
    const raw = err instanceof Error ? err.message : "Unknown error";
    const errorMessage = `${aliasLabel} (powered by ${imagenModel}): ${raw}`;
    await db.insert(usageLogsTable).values({
      apiKeyId: apiKey.id, model: aliasLabel, inputTokens: 0, outputTokens: 0,
      totalTokens: 0, costUsd: 0, requestId, status: "error", errorMessage,
    });
    res.status(502).json({
      error: { message: errorMessage, type: "api_error" },
    });
    return;
  }

  // Atomically deduct + log via the unified billing helper. Routes the debit
  // to the correct target (user OR organization) based on apiKey.billingTarget.
  // We pass `aliasLabel` so logs/invoices show the user-facing model name
  // (e.g. "dall-e-3") rather than the underlying Imagen backend.
  const sufficient = await deductAndLog(
    apiKey.billingTarget, apiKey.id, aliasLabel, requestId, 0, n, costUsd, { modelInPlan },
  );

  if (!sufficient) {
    res.status(402).json({
      error: { message: "Insufficient credits to complete this request.", type: "insufficient_credit" },
    });
    return;
  }

  void dispatchWebhooks(apiKey.userId, "usage.success", {
    model: aliasLabel,
    requestId,
    imageCount: n,
    costUsd,
  });

  // OpenAI-shaped response: { created, data: [{ b64_json }] }
  res.status(200).json({
    created: Math.floor(Date.now() / 1000),
    data: result.images.map((img) => ({ b64_json: img.base64 })),
  });
});

export default router;
