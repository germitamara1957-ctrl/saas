import { Router, type IRouter } from "express";
import { db, usageLogsTable } from "@workspace/db";
import { requireApiKey } from "../../middlewares/apiKeyAuth";
import { checkRateLimit } from "../../lib/rateLimit";
import { generateRequestId } from "../../lib/crypto";
import { getActiveProvider, getAccessToken } from "../../lib/vertexai-provider";
import { deductAndLog } from "../../lib/chatUtils";
import { logger } from "../../lib/logger";

const router: IRouter = Router();

const SUPPORTED_EMBEDDING_MODELS = new Set([
  "text-embedding-004",
  "text-embedding-005",
  "text-multilingual-embedding-002",
]);

const DEFAULT_MODEL = "text-embedding-004";

const COST_PER_1K_INPUT_TOKENS = 0.000025;
const MARKUP = 1.1;

router.post("/v1/embeddings", requireApiKey, async (req, res): Promise<void> => {
  const apiKey = req.apiKey!;
  const requestId = req.preassignedRequestId ?? generateRequestId();
  const startedAt = Date.now();

  const body = req.body ?? {};
  const requestedModel = (body.model as string | undefined) ?? DEFAULT_MODEL;
  const model = SUPPORTED_EMBEDDING_MODELS.has(requestedModel) ? requestedModel : DEFAULT_MODEL;
  const input = body.input;

  // Normalize input → array of strings
  let texts: string[];
  if (typeof input === "string") texts = [input];
  else if (Array.isArray(input) && input.every((s) => typeof s === "string")) texts = input as string[];
  else {
    res.status(400).json({ error: { message: "`input` must be a string or array of strings", type: "invalid_request_error" } });
    return;
  }
  if (texts.length === 0) {
    res.status(400).json({ error: { message: "`input` cannot be empty", type: "invalid_request_error" } });
    return;
  }
  if (texts.length > 250) {
    res.status(400).json({ error: { message: "`input` cannot exceed 250 items", type: "invalid_request_error" } });
    return;
  }

  // Per-key or per-user rate limit
  const _rpm = apiKey.rpmLimit ?? apiKey.plan.rpm;
  const _bucket = apiKey.rpmLimit ? -apiKey.id : apiKey.userId;
  const ok = await checkRateLimit(_bucket, _rpm, "embeddings");
  if (!ok) {
    res.status(429).json({ error: { message: `Rate limit exceeded (${_rpm} rpm)`, type: "requests" } });
    return;
  }

  try {
    const provider = await getActiveProvider();
    const token = await getAccessToken(provider);
    const url = `https://${provider.location}-aiplatform.googleapis.com/v1/projects/${provider.projectId}/locations/${provider.location}/publishers/google/models/${model}:predict`;

    const upstream = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        instances: texts.map((content) => ({ content, task_type: "RETRIEVAL_DOCUMENT" })),
      }),
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      logger.warn({ requestId, status: upstream.status, errText }, "embeddings upstream error");
      await db.insert(usageLogsTable).values({
        apiKeyId: apiKey.id, model, requestId, status: "error",
        errorMessage: errText.slice(0, 1000),
      });
      res.status(502).json({ error: { message: `Upstream error: ${errText.slice(0, 200)}`, type: "server_error" } });
      return;
    }

    const data = await upstream.json() as {
      predictions: Array<{ embeddings: { values: number[]; statistics: { token_count: number } } }>;
    };

    const embeddings = data.predictions.map((p, idx) => ({
      object: "embedding",
      index: idx,
      embedding: p.embeddings.values,
    }));

    const totalTokens = data.predictions.reduce((s, p) => s + (p.embeddings.statistics?.token_count ?? 0), 0);
    const costUsd = (totalTokens / 1000) * COST_PER_1K_INPUT_TOKENS * MARKUP;

    // Embedding models are not part of plan model lists — bill against top-up only.
    const sufficient = await deductAndLog(
      apiKey.billingTarget, apiKey.id, model, requestId, totalTokens, 0, costUsd, { modelInPlan: false },
    );
    if (!sufficient) {
      res.status(402).json({ error: { message: "Insufficient top-up credits for embeddings", type: "insufficient_quota" } });
      return;
    }

    res.json({
      object: "list",
      data: embeddings,
      model,
      usage: { prompt_tokens: totalTokens, total_tokens: totalTokens },
      _meta: { requestId, costUsd, latencyMs: Date.now() - startedAt },
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    logger.error({ err, requestId }, "embeddings handler error");
    await db.insert(usageLogsTable).values({
      apiKeyId: apiKey.id, model, requestId, status: "error", errorMessage,
    }).catch(() => {});
    res.status(502).json({ error: { message: `Embeddings error: ${errorMessage}`, type: "server_error" } });
  }
});

export default router;
