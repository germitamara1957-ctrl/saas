import { Router, type IRouter } from "express";
import multer from "multer";
import { db, usageLogsTable } from "@workspace/db";
import { requireApiKey } from "../../middlewares/apiKeyAuth";
import { checkRateLimit } from "../../lib/rateLimit";
import { generateRequestId } from "../../lib/crypto";
import { editImageWithImagen } from "../../lib/vertexai-imagen";
import { calculateImageCost } from "../../lib/billing";
import { deductAndLog, isModelInPlan } from "../../lib/chatUtils";
import { logger } from "../../lib/logger";

const router: IRouter = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = file.mimetype === "image/png" || file.mimetype === "image/jpeg" || file.mimetype === "image/webp";
    if (ok) cb(null, true);
    else cb(new Error("Only PNG, JPEG, or WebP images are allowed"));
  },
});

// Resolve any model alias to the capability inpainting model.
// We only support one backend model for inpainting on Vertex AI.
const BILLING_MODEL = "imagen-3.0-capability-001";

router.post(
  "/v1/images/edits",
  requireApiKey,
  upload.fields([{ name: "image", maxCount: 1 }, { name: "mask", maxCount: 1 }]),
  async (req, res): Promise<void> => {
    const apiKey = req.apiKey!;
    const requestId = req.preassignedRequestId ?? generateRequestId();
    const startedAt = Date.now();

    try {
      const files = req.files as { image?: Express.Multer.File[]; mask?: Express.Multer.File[] } | undefined;
      const imageFile = files?.image?.[0];
      const maskFile = files?.mask?.[0];
      const prompt = (req.body?.prompt as string | undefined)?.trim();
      const n = Math.max(1, Math.min(4, Number(req.body?.n ?? 1)));

      if (!imageFile) {
        res.status(400).json({ error: { message: "`image` file is required (multipart/form-data)", type: "invalid_request_error" } });
        return;
      }
      if (!maskFile) {
        res.status(400).json({ error: { message: "`mask` file is required (multipart/form-data)", type: "invalid_request_error" } });
        return;
      }
      if (!prompt) {
        res.status(400).json({ error: { message: "`prompt` is required", type: "invalid_request_error" } });
        return;
      }
      if (prompt.length > 4000) {
        res.status(400).json({ error: { message: "`prompt` exceeds 4000 character limit", type: "invalid_request_error" } });
        return;
      }

      const planAllows = isModelInPlan(apiKey.plan.modelsAllowed ?? [], BILLING_MODEL);

      const _rpm = apiKey.rpmLimit ?? apiKey.plan.rpm;
      const _bucket = apiKey.rpmLimit ? -apiKey.id : apiKey.userId;
      const ok = await checkRateLimit(_bucket, _rpm, "images-edits");
      if (!ok) {
        res.status(429).json({ error: { message: `Rate limit exceeded (${_rpm} rpm)`, type: "requests" } });
        return;
      }

      const result = await editImageWithImagen(
        BILLING_MODEL,
        prompt,
        imageFile.buffer.toString("base64"),
        maskFile.buffer.toString("base64"),
        n,
      );

      const costUsd = calculateImageCost(BILLING_MODEL, result.images.length);

      const sufficient = await deductAndLog(
        apiKey.billingTarget, apiKey.id, BILLING_MODEL, requestId, 0, 0, costUsd, { modelInPlan: planAllows },
      );
      if (!sufficient) {
        res.status(402).json({ error: { message: "Insufficient credits for image edit", type: "insufficient_quota" } });
        return;
      }

      // OpenAI-compatible response: data: [{ b64_json: ... }, ...]
      res.json({
        created: Math.floor(Date.now() / 1000),
        data: result.images.map((img) => ({ b64_json: img.base64 })),
        _meta: { requestId, costUsd, latencyMs: Date.now() - startedAt, model: BILLING_MODEL },
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      logger.error({ err, requestId }, "images/edits handler error");
      await db.insert(usageLogsTable).values({
        apiKeyId: apiKey.id, model: BILLING_MODEL, requestId, status: "error", errorMessage,
      }).catch(() => {});
      res.status(502).json({ error: { message: `Image edit error: ${errorMessage}`, type: "server_error" } });
    }
  },
);

export default router;
