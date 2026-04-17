export interface TextPart {
  type: "text";
  text: string;
}

export interface ImagePart {
  type: "image";
  mimeType: string;
  base64: string;
}

export type ContentPart = TextPart | ImagePart;

export interface ChatMessage {
  role: "user" | "model";
  content: string | ContentPart[];
}

export interface ChatResult {
  content: string;
  inputTokens: number;
  outputTokens: number;
}

export interface ImageResult {
  images: Array<{ base64: string; mimeType: string }>;
}

export interface VideoJobResult {
  operationName: string;
}

export interface VideoJobStatus {
  done: boolean;
  videoUri?: string;
  error?: string;
}

export type ModelProvider = "gemini" | "openai-compat" | "mistral-raw-predict";

/**
 * Vertex AI serves Gemini 3.x preview models only from the "global"
 * multi-region endpoint — NOT from regional locations like us-central1.
 */
export const GEMINI_GLOBAL_LOCATION_MODELS = new Set([
  "gemini-3.1-pro-preview",
  "gemini-3.1-flash-lite-preview",
  "gemini-3.1-flash-image-preview",
  // Gemini 3.0 models — correct Resource IDs per Google docs (no ".0" in name)
  // Note: gemini-3-pro-preview removed — project has no GCP access to it
  "gemini-3-flash-preview",
  "gemini-3-pro-image-preview",
]);

export const GEMINI_ALIASES: Record<string, string> = {
  "imagen-4":       "imagen-4.0-generate-001",
  "imagen-4-ultra": "imagen-4.0-ultra-generate-001",
  "imagen-3":       "imagen-3.0-generate-002",
  "imagen-3-fast":  "imagen-3.0-fast-generate-001",
  "veo-3.1":        "veo-3.1-generate-001",
  "veo-3.1-fast":   "veo-3.1-fast-generate-001",
  "veo-3":          "veo-3.0-generate-001",
  "veo-2":          "veo-2.0-generate-001",
  // OpenAI Sora-compatible aliases (n8n / OpenAI SDK use these names)
  "sora-2":         "veo-3.1-fast-generate-001",
  "sora-2-pro":     "veo-3.1-generate-001",
  // OpenAI Image-compatible aliases (n8n OpenAI Image node / OpenAI SDK use these names)
  // Mapped worst → worst, best → best to preserve user expectations.
  "dall-e-2":       "imagen-3.0-fast-generate-001",
  "dall-e-3":       "imagen-4.0-generate-001",
  "gpt-image-1":    "imagen-4.0-ultra-generate-001",
  "imagen-3.0-generate-001": "imagen-3.0-generate-002",
  // Image editing / inpainting capability model
  "imagen-edit":    "imagen-3.0-capability-001",
  "dall-e-2-edit":  "imagen-3.0-capability-001",
  // Backward-compat aliases: old .0 names → correct Resource IDs per Google docs
  // gemini-3.0-pro-preview removed — no GCP project access
  "gemini-3.0-flash-preview":     "gemini-3-flash-preview",
  "gemini-3.0-pro-image-preview": "gemini-3-pro-image-preview",
};

export const OPENAI_COMPAT_IDS: Record<string, string> = {
  "grok-4.20":         "xai/grok-4.20-non-reasoning",
  "grok-4.1-thinking": "xai/grok-4.1-fast-reasoning",
  "deepseek-v3.2":     "deepseek-ai/deepseek-v3.2-maas",
  "gemma-4-26b":       "google/gemma-4-26b-a4b-it-maas",
  "minimax-m2":        "minimaxai/minimax-m2-maas",
  "kimi-k2":           "moonshotai/kimi-k2-thinking-maas",
  // Zhipu AI GLM-5 — publisher: zai-org, global endpoint only
  "glm-5":             "zai-org/glm-5-maas",
};

/**
 * Mistral models use the rawPredict endpoint (regional, not global MaaS).
 * URL: https://{location}-aiplatform.googleapis.com/v1/projects/{project}
 *        /locations/{location}/publishers/mistralai/models/{modelId}:rawPredict
 *
 * Key differences from OPENAI_COMPAT_IDS:
 *   - Publisher: "mistralai" (no hyphen)
 *   - Endpoint: rawPredict (not /endpoints/openapi/chat/completions)
 *   - URL is regional (uses provider.location, not "global")
 *   - Model ID in request body is just the bare model ID (e.g. "mistral-small-2503")
 */
export const MISTRAL_RAW_PREDICT_IDS: Record<string, string> = {
  // Mistral Small 3.1 (25.03)
  "mistral-small": "mistral-small-2503",
};

/**
 * Detects which backend to use based on the model name.
 *
 *   gemini-* / imagen-* / veo-*           → Google Vertex AI Gemini SDK
 *   mistral-* / codestral-* / ministral-* → Mistral rawPredict endpoint (regional)
 *   everything else                        → OpenAI-compatible endpoint via Vertex AI MaaS
 *
 * Mistral detection uses TWO layers for safety:
 *   1. Exact lookup in MISTRAL_RAW_PREDICT_IDS  — known models (e.g. "mistral-small")
 *   2. Prefix matching for known Mistral families — catches future models automatically
 *      even before they are added to the map.  resolveMistralModelId() then uses the
 *      model name as-is when no mapping exists, letting the endpoint decide.
 */
export function detectModelProvider(model: string): ModelProvider {
  const m = model.toLowerCase().trim();
  if (m.startsWith("gemini-") || m.startsWith("imagen-") || m.startsWith("veo-")) return "gemini";
  if (
    m in MISTRAL_RAW_PREDICT_IDS ||
    m.startsWith("mistral-") ||
    m.startsWith("codestral-") ||
    m.startsWith("ministral-")
  ) return "mistral-raw-predict";
  return "openai-compat";
}

/**
 * Resolves a friendly model name to the actual Vertex AI model ID (Gemini only).
 */
export function resolveVertexModelId(model: string): string {
  const normalised = model.toLowerCase().trim();
  return GEMINI_ALIASES[normalised] ?? normalised;
}

/**
 * Normalises any model identifier to the canonical form stored in plan.modelsAllowed.
 */
export function normalizeToPlanModelId(model: string): string {
  const normalised = model.toLowerCase().trim();
  return GEMINI_ALIASES[normalised] ?? normalised;
}
