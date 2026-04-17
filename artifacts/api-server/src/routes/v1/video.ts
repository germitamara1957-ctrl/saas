import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, usageLogsTable } from "@workspace/db";
import { GenerateVideoBody } from "@workspace/api-zod";
import { requireApiKey, requireApiKeyLight } from "../../middlewares/apiKeyAuth";
import { generateRequestId } from "../../lib/crypto";
import { dispatchWebhooks } from "../../lib/webhookDispatcher";
import {
  createVideoJob,
  getVideoStatusForUser,
  streamVideoContent,
  waitForVideo,
  refundFailedVideoJob,
} from "../../lib/videoService";
import { logger } from "../../lib/logger";

const router: IRouter = Router();

/**
 * POST /v1/video — native (non-Sora) video generation endpoint.
 *
 * Thin adapter over `videoService` — all heavy lifting (validation, plan
 * checks, billing, idempotency, rate-limit, Veo call, refund) is in the
 * service so `/v1/videos` (Sora-compat) can share the exact same logic
 * without going through HTTP loopback.
 */
router.post("/v1/video", requireApiKey, async (req, res): Promise<void> => {
  // Coerce common string-typed numeric inputs (n8n sends numbers as strings).
  if (req.body && typeof req.body === "object") {
    if (typeof req.body.durationSeconds === "string" && req.body.durationSeconds.trim() !== "") {
      const n = Number(req.body.durationSeconds);
      if (!Number.isNaN(n)) req.body.durationSeconds = n;
    }
  }

  const parsed = GenerateVideoBody.safeParse(req.body);
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

  const {
    model: rawModel = "veo-3.1-generate-001",
    prompt,
    durationSeconds: rawDur = 5,
    sampleCount: rawSamples = 1,
  } = parsed.data as { model?: string; prompt: string; durationSeconds?: number | string; sampleCount?: number | string };

  const model = rawModel.toLowerCase().trim();
  const durationSeconds = Math.trunc(Number(rawDur));
  const sampleCount = Math.trunc(Number(rawSamples));
  const apiKey = req.apiKey!;
  const requestId = req.preassignedRequestId ?? generateRequestId();

  const waitFlag =
    req.query.wait === "true" || req.query.wait === "1" ||
    (req.body && (req.body.wait === true || req.body.wait === "true" || req.body.wait === "1"));
  const waitTimeoutMs = Math.min(
    240_000,
    Math.max(30_000, Number(req.query.waitTimeoutMs ?? req.body?.waitTimeoutMs ?? 180_000)),
  );

  res.setHeader("X-Backend-Model", model);

  const result = await createVideoJob({
    apiKey, model, prompt, durationSeconds, sampleCount, requestId,
  });

  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }

  const downloadUrlBase = `${req.protocol}://${req.get("host")}/api/v1/video/${result.jobId}/download`;

  // Wait mode — block until ready or timeout.
  if (waitFlag) {
    const finalStatus = await waitForVideo(result.operationName, waitTimeoutMs);
    if (finalStatus.done) {
      const err = "error" in finalStatus ? finalStatus.error : undefined;
      let refund = { refunded: false, amount: 0 };
      if (err) {
        refund = await refundFailedVideoJob(result.jobId, apiKey.id, apiKey.userId, err);
      }
      const videoUrl = err ? null : ((finalStatus as { videoUri?: string }).videoUri ?? null);

      void dispatchWebhooks(apiKey.userId, err ? "video.failed" : "video.completed", {
        jobId: result.jobId, model, videoUrl,
        downloadUrl: err ? null : downloadUrlBase,
        costUsd: err && refund.refunded ? 0 : result.costUsd,
        errorMessage: err ?? null,
        refunded: err ? refund.refunded : undefined,
      }).catch(() => {});

      res.json({
        jobId: result.jobId,
        status: err ? "failed" : "completed",
        videoUrl,
        downloadUrl: err ? null : downloadUrlBase,
        errorMessage: err ?? null,
        model,
        costUsd: err && refund.refunded ? 0 : result.costUsd,
        refunded: err ? refund.refunded : undefined,
        refundAmount: err && refund.refunded ? refund.amount : undefined,
        ...(result.duplicateOf ? { duplicateOf: result.duplicateOf } : {}),
      });
      return;
    }
    res.status(202).json({
      jobId: result.jobId,
      status: "pending",
      videoUrl: null,
      errorMessage: null,
      model,
      costUsd: result.costUsd,
      statusUrl: `/api/v1/video/${result.jobId}/status`,
      pollIntervalSeconds: 10,
      note: `Video not ready after ${Math.round(waitTimeoutMs / 1000)}s — poll statusUrl to retrieve it.`,
    });
    return;
  }

  // Default async mode
  res.status(result.duplicateOf ? 200 : 202).json({
    jobId: result.jobId,
    status: "pending",
    videoUrl: null,
    errorMessage: null,
    model,
    costUsd: result.costUsd,
    statusUrl: `/api/v1/video/${result.jobId}/status`,
    pollIntervalSeconds: 10,
    estimatedSeconds: 60,
    ...(result.duplicateOf
      ? { duplicateOf: result.duplicateOf, note: "Duplicate request detected — returning existing job (no additional charge)." }
      : {}),
  });
});

router.get("/v1/video/:jobId/status", requireApiKeyLight, async (req, res): Promise<void> => {
  const jobId = String(req.params.jobId);
  const apiKey = req.apiKey!;
  const status = await getVideoStatusForUser(apiKey, jobId);
  if (!status.ok) {
    res.status(status.status).json({ error: status.error });
    return;
  }

  res.setHeader("X-Backend-Model", status.model);

  const downloadUrl = status.status === "completed"
    ? `${req.protocol}://${req.get("host")}/api/v1/video/${jobId}/download`
    : null;

  // Webhook fire only when failure transitions (refund.refunded just flipped true).
  if (status.status === "failed" && status.refunded) {
    void dispatchWebhooks(apiKey.userId, "video.failed", {
      jobId, model: status.model, videoUrl: null, downloadUrl: null,
      costUsd: 0, errorMessage: status.errorMessage, refunded: true,
    }).catch(() => {});
  } else if (status.status === "completed") {
    void dispatchWebhooks(apiKey.userId, "video.completed", {
      jobId, model: status.model, videoUrl: status.videoUri, downloadUrl,
      costUsd: status.costUsd, errorMessage: null,
    }).catch(() => {});
  }

  res.json({
    jobId,
    status: status.status,
    videoUrl: status.videoUri,
    downloadUrl,
    errorMessage: status.errorMessage,
    model: status.model,
    costUsd: status.costUsd,
    ...(status.refunded ? { refunded: true, refundAmount: status.refundAmount } : {}),
  });
});

router.get("/v1/video/:jobId/download", requireApiKeyLight, async (req, res): Promise<void> => {
  const jobId = String(req.params.jobId);
  try {
    await streamVideoContent(req.apiKey!, jobId, res);
  } catch (err) {
    logger.warn({ err, jobId }, "streamVideoContent failed");
    if (!res.headersSent) {
      res.status(502).json({ error: "Video download failed" });
    }
  }
});

export default router;
