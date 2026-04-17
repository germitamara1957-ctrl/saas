import { Router, type IRouter } from "express";
import multer from "multer";
import { db, usageLogsTable } from "@workspace/db";
import { requireApiKey } from "../../middlewares/apiKeyAuth";
import { checkRateLimit } from "../../lib/rateLimit";
import { generateRequestId } from "../../lib/crypto";
import { synthesizeSpeech, transcribeAudio } from "../../lib/vertexai-audio";
import { calculateTtsCost, calculateSttCost } from "../../lib/billing";
import { deductAndLog, isModelInPlan } from "../../lib/chatUtils";
import { logger } from "../../lib/logger";

const router: IRouter = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = file.mimetype.startsWith("audio/") || file.mimetype === "video/webm" || file.mimetype === "application/octet-stream";
    if (ok) cb(null, true);
    else cb(new Error("Only audio files are allowed"));
  },
});

const SUPPORTED_TTS = new Set(["tts-1", "tts-1-hd"]);
const STT_MODEL = "whisper-1";

// ─── POST /v1/audio/speech (TTS) ─────────────────────────────────────────────
router.post("/v1/audio/speech", requireApiKey, async (req, res): Promise<void> => {
  const apiKey = req.apiKey!;
  const requestId = req.preassignedRequestId ?? generateRequestId();
  const startedAt = Date.now();

  try {
    const body = req.body ?? {};
    const requestedModel = String(body.model ?? "tts-1").toLowerCase();
    const model = SUPPORTED_TTS.has(requestedModel) ? requestedModel : "tts-1";
    const input = typeof body.input === "string" ? body.input.trim() : "";
    const voice = body.voice ? String(body.voice) : "alloy";
    const format = body.response_format ? String(body.response_format) : "mp3";
    const speed = body.speed ? Number(body.speed) : 1.0;

    if (!input) {
      res.status(400).json({ error: { message: "`input` is required", type: "invalid_request_error" } });
      return;
    }
    if (input.length > 4096) {
      res.status(400).json({ error: { message: "`input` exceeds 4096 character limit", type: "invalid_request_error" } });
      return;
    }

    const planAllows = isModelInPlan(apiKey.plan.modelsAllowed ?? [], model);

    const _rpm = apiKey.rpmLimit ?? apiKey.plan.rpm;
    const _bucket = apiKey.rpmLimit ? -apiKey.id : apiKey.userId;
    const ok = await checkRateLimit(_bucket, _rpm, "audio-speech");
    if (!ok) {
      res.status(429).json({ error: { message: `Rate limit exceeded (${_rpm} rpm)`, type: "requests" } });
      return;
    }

    const result = await synthesizeSpeech({ model, text: input, voice, format, speed });
    const costUsd = calculateTtsCost(model, result.characters);

    const sufficient = await deductAndLog(
      apiKey.billingTarget, apiKey.id, model, requestId, result.characters, 0, costUsd, { modelInPlan: planAllows },
    );
    if (!sufficient) {
      res.status(402).json({ error: { message: "Insufficient credits for TTS", type: "insufficient_quota" } });
      return;
    }

    res.setHeader("Content-Type", result.mimeType);
    res.setHeader("X-Request-Id", requestId);
    res.setHeader("X-Cost-Usd", costUsd.toFixed(6));
    res.setHeader("X-Latency-Ms", String(Date.now() - startedAt));
    res.send(result.bytes);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    logger.error({ err, requestId }, "audio/speech handler error");
    await db.insert(usageLogsTable).values({
      apiKeyId: apiKey.id, model: "tts-1", requestId, status: "error", errorMessage,
    }).catch(() => {});
    res.status(502).json({ error: { message: `TTS error: ${errorMessage}`, type: "server_error" } });
  }
});

// ─── POST /v1/audio/transcriptions (STT) ─────────────────────────────────────
router.post(
  "/v1/audio/transcriptions",
  requireApiKey,
  upload.single("file"),
  async (req, res): Promise<void> => {
    const apiKey = req.apiKey!;
    const requestId = req.preassignedRequestId ?? generateRequestId();
    const startedAt = Date.now();

    try {
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: { message: "`file` is required (multipart/form-data)", type: "invalid_request_error" } });
        return;
      }
      const language = req.body?.language ? String(req.body.language) : undefined;
      const responseFormat = req.body?.response_format ? String(req.body.response_format) : "json";

      const planAllows = isModelInPlan(apiKey.plan.modelsAllowed ?? [], STT_MODEL);

      const _rpm = apiKey.rpmLimit ?? apiKey.plan.rpm;
      const _bucket = apiKey.rpmLimit ? -apiKey.id : apiKey.userId;
      const ok = await checkRateLimit(_bucket, _rpm, "audio-stt");
      if (!ok) {
        res.status(429).json({ error: { message: `Rate limit exceeded (${_rpm} rpm)`, type: "requests" } });
        return;
      }

      const result = await transcribeAudio({
        audio: file.buffer,
        mimeType: file.mimetype || "audio/mpeg",
        language,
      });

      const costUsd = calculateSttCost(STT_MODEL, result.durationSeconds);

      const sufficient = await deductAndLog(
        apiKey.billingTarget, apiKey.id, STT_MODEL, requestId,
        Math.ceil(result.durationSeconds), 0, costUsd, { modelInPlan: planAllows },
      );
      if (!sufficient) {
        res.status(402).json({ error: { message: "Insufficient credits for STT", type: "insufficient_quota" } });
        return;
      }

      if (responseFormat === "text") {
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.send(result.text);
        return;
      }

      res.json({
        text: result.text,
        language: result.language,
        duration: result.durationSeconds,
        _meta: { requestId, costUsd, latencyMs: Date.now() - startedAt, model: STT_MODEL },
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      logger.error({ err, requestId }, "audio/transcriptions handler error");
      await db.insert(usageLogsTable).values({
        apiKeyId: apiKey.id, model: STT_MODEL, requestId, status: "error", errorMessage,
      }).catch(() => {});
      res.status(502).json({ error: { message: `STT error: ${errorMessage}`, type: "server_error" } });
    }
  },
);

export default router;
