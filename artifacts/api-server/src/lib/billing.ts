import { eq } from "drizzle-orm";
import { db, modelCostsTable } from "@workspace/db";
import { logger } from "./logger";

export interface ModelCost {
  inputPer1M: number;
  outputPer1M: number;
  perImage?: number;
  perSecond?: number;
}

/**
 * Hardcoded fallback prices — used when DB has no entry for a model.
 * These are the source of truth for the initial seed.
 */
export const MODEL_COSTS: Record<string, ModelCost> = {
  // ─── Gemini 2.5 (official Vertex AI pricing, Apr 2026) ───────────────────
  "gemini-2.5-pro":                  { inputPer1M: 1.25,  outputPer1M: 10.00 },
  "gemini-2.5-flash":                { inputPer1M: 0.30,  outputPer1M:  2.50 },
  "gemini-2.5-flash-lite":           { inputPer1M: 0.10,  outputPer1M:  0.40 },
  // ─── Gemini 3.1 (official Vertex AI pricing, Apr 2026) ───────────────────
  "gemini-3.1-pro-preview":          { inputPer1M: 2.00,  outputPer1M: 12.00 },
  "gemini-3.1-flash-lite-preview":   { inputPer1M: 0.25,  outputPer1M:  1.50 },
  "gemini-3.1-flash-image-preview":  { inputPer1M: 0.50,  outputPer1M:  3.00 },
  // ─── Gemini 3.0 (correct Resource IDs per Google docs — no ".0" in name) ──
  // gemini-3-pro-preview removed — no GCP project access (404)
  "gemini-3-flash-preview":          { inputPer1M: 0.50,  outputPer1M:  3.00 },
  "gemini-3-pro-image-preview":      { inputPer1M: 2.00,  outputPer1M: 12.00 },
  // ─── Imagen (official Vertex AI pricing, Apr 2026) ───────────────────────
  "imagen-4.0-generate-001":         { inputPer1M: 0, outputPer1M: 0, perImage: 0.04  },
  "imagen-4.0-ultra-generate-001":   { inputPer1M: 0, outputPer1M: 0, perImage: 0.06  },
  "imagen-3.0-generate-002":         { inputPer1M: 0, outputPer1M: 0, perImage: 0.04  },
  "imagen-3.0-fast-generate-001":    { inputPer1M: 0, outputPer1M: 0, perImage: 0.02  },
  // ─── Veo (official Vertex AI pricing, Apr 2026 — Video+Audio at 1080p) ───
  "veo-3.1-generate-001":            { inputPer1M: 0, outputPer1M: 0, perSecond: 0.40 },
  "veo-3.1-fast-generate-001":       { inputPer1M: 0, outputPer1M: 0, perSecond: 0.12 },
  "veo-3.0-generate-001":            { inputPer1M: 0, outputPer1M: 0, perSecond: 0.40 },
  "veo-2.0-generate-001":            { inputPer1M: 0, outputPer1M: 0, perSecond: 0.50 },
  // ─── OpenAI Sora-compatible aliases (mapped to Veo 3.1 backend) ─────────
  "sora-2":                          { inputPer1M: 0, outputPer1M: 0, perSecond: 0.12 },
  "sora-2-pro":                      { inputPer1M: 0, outputPer1M: 0, perSecond: 0.40 },
  // ─── OpenAI Image-compatible aliases (mapped to Imagen backend) ─────────
  // Same prices as the actual backend models — no hidden markup.
  "dall-e-2":                        { inputPer1M: 0, outputPer1M: 0, perImage: 0.02 },
  "dall-e-3":                        { inputPer1M: 0, outputPer1M: 0, perImage: 0.04 },
  "gpt-image-1":                     { inputPer1M: 0, outputPer1M: 0, perImage: 0.06 },
  // ─── Grok / xAI (official Vertex AI pricing, Apr 2026) ───────────────────
  "grok-4.20":                       { inputPer1M:  0.20, outputPer1M:  0.50 },
  "grok-4.1-thinking":               { inputPer1M:  0.20, outputPer1M:  0.50 },
  // ─── DeepSeek (official Vertex AI pricing, Apr 2026) ─────────────────────
  "deepseek-v3.2":                   { inputPer1M:  0.56, outputPer1M:  1.68 },
  // ─── Google Gemma MaaS (via Vertex AI) ───────────────────────────────────
  "gemma-4-26b":                     { inputPer1M:  0.20, outputPer1M:  0.80 },
  // ─── Kimi / Moonshot AI (official Vertex AI pricing, Apr 2026) ───────────
  "kimi-k2":                         { inputPer1M:  0.60, outputPer1M:  2.50 },
  // ─── MiniMax (official Vertex AI pricing, Apr 2026) ──────────────────────
  "minimax-m2":                      { inputPer1M:  0.30, outputPer1M:  1.20 },
  // ─── Zhipu AI GLM-5 via Vertex AI MaaS (zai-org/glm-5-maas) ─────────────
  "glm-5":                           { inputPer1M:  0.50, outputPer1M:  1.50 },
  // ─── Mistral AI — Mistral Small 3.1 (25.03) via Vertex AI MaaS ───────────
  "mistral-small":                   { inputPer1M:  0.10, outputPer1M:  0.30 },
  // ─── Imagen Inpainting / Edits (capability model — same per-image price) ──
  "imagen-3.0-capability-001":       { inputPer1M: 0, outputPer1M: 0, perImage: 0.04 },
  // ─── Audio TTS — billed per 1M characters in `inputPer1M` ────────────────
  // Standard / Neural2 / WaveNet voices (~$4/1M chars → ~$16/1M w/ Studio).
  "tts-1":                           { inputPer1M: 4.00,  outputPer1M: 0 },
  "tts-1-hd":                        { inputPer1M: 16.00, outputPer1M: 0 },
  // ─── Audio STT — billed per second in `perSecond` ────────────────────────
  // Google Chirp 2 ≈ $0.024 / minute = $0.0004 / second.
  "whisper-1":                       { inputPer1M: 0, outputPer1M: 0, perSecond: 0.0004 },
};

export const MARKUP_FACTOR = 1.1;
const CACHE_TTL_MS = 5 * 60_000;

let _costsCache: Map<string, ModelCost> | null = null;
let _cacheExpiresAt = 0;

/**
 * Load (or refresh) the model costs cache from DB.
 * Falls back gracefully to hardcoded MODEL_COSTS if DB is unreachable.
 */
export async function warmModelCostsCache(): Promise<void> {
  try {
    const rows = await db
      .select()
      .from(modelCostsTable)
      .where(eq(modelCostsTable.isActive, true));

    const map = new Map<string, ModelCost>();
    for (const row of rows) {
      map.set(row.model, {
        inputPer1M: row.inputPer1M,
        outputPer1M: row.outputPer1M,
        perImage: row.perImage ?? undefined,
        perSecond: row.perSecond ?? undefined,
      });
    }
    _costsCache = map;
    _cacheExpiresAt = Date.now() + CACHE_TTL_MS;
  } catch (err) {
    logger.error({ err }, "[billing] Failed to warm model costs cache from DB — using hardcoded fallback");
  }
}

function getCost(model: string): ModelCost {
  if (_costsCache && Date.now() < _cacheExpiresAt) {
    const cached = _costsCache.get(model);
    if (cached) return cached;
  }
  const fallback = MODEL_COSTS[model];
  if (!fallback) {
    logger.warn({ model }, `[billing] Unknown model "${model}" — applying default pricing. Add it via the admin pricing page.`);
  }
  return fallback ?? { inputPer1M: 1.25, outputPer1M: 5.00 };
}

export function calculateChatCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const costs = getCost(model);
  const baseCost =
    (inputTokens / 1_000_000) * costs.inputPer1M +
    (outputTokens / 1_000_000) * costs.outputPer1M;
  return baseCost * MARKUP_FACTOR;
}

export function calculateImageCost(model: string, count = 1): number {
  const costs = getCost(model);
  return (costs.perImage ?? 0.04) * count * MARKUP_FACTOR;
}

export function calculateVideoCost(model: string, durationSeconds: number): number {
  const costs = getCost(model);
  return (costs.perSecond ?? 0.50) * durationSeconds * MARKUP_FACTOR;
}

/**
 * Audio TTS pricing — re-uses inputPer1M as the per-1M-characters rate.
 */
export function calculateTtsCost(model: string, characters: number): number {
  const costs = getCost(model);
  return (characters / 1_000_000) * costs.inputPer1M * MARKUP_FACTOR;
}

/**
 * Audio STT pricing — billed per second of audio duration.
 */
export function calculateSttCost(model: string, durationSeconds: number): number {
  const costs = getCost(model);
  return (costs.perSecond ?? 0.0004) * durationSeconds * MARKUP_FACTOR;
}

export function getSupportedModels(): string[] {
  // Prefer the DB-backed cache (even if stale) because the admin may have
  // deleted models that are still present in the hardcoded MODEL_COSTS list.
  // Only fall back to MODEL_COSTS on first boot (before the cache is populated).
  if (_costsCache) {
    return [..._costsCache.keys()];
  }
  return Object.keys(MODEL_COSTS);
}
