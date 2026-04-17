export type ModelCategory = "text" | "image" | "video" | "embedding" | "audio";

export type ModelProvider =
  | "google-gemini"
  | "google-imagen"
  | "google-veo"
  | "google-gemma"
  | "xai"
  | "deepseek"
  | "kimi"
  | "minimax"
  | "mistral"
  | "zhipu"
  | "meta"
  | "openai-oss"
  | "qwen";

export interface ProviderMeta {
  label: string;
  shortLabel: string;
  color: string;
  bg: string;
  border: string;
  dot: string;
}

export const PROVIDER_META: Record<ModelProvider, ProviderMeta> = {
  "google-gemini": { label: "Google — Gemini",     shortLabel: "Gemini",   color: "text-blue-600 dark:text-blue-400",     bg: "bg-blue-500/10",    border: "border-blue-500/30",    dot: "bg-blue-500"    },
  "google-imagen": { label: "Google — Imagen",     shortLabel: "Imagen",   color: "text-violet-600 dark:text-violet-400", bg: "bg-violet-500/10",  border: "border-violet-500/30",  dot: "bg-violet-500"  },
  "google-veo":    { label: "Google — Veo",        shortLabel: "Veo",      color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/30", dot: "bg-emerald-500" },
  "google-gemma":  { label: "Google — Gemma MaaS", shortLabel: "Gemma",    color: "text-teal-600 dark:text-teal-400",     bg: "bg-teal-500/10",    border: "border-teal-500/30",    dot: "bg-teal-500"    },
  xai:             { label: "xAI — Grok",          shortLabel: "Grok",     color: "text-slate-600 dark:text-slate-300",   bg: "bg-slate-500/10",   border: "border-slate-500/30",   dot: "bg-slate-400"   },
  deepseek:        { label: "DeepSeek",             shortLabel: "DeepSeek", color: "text-indigo-600 dark:text-indigo-400", bg: "bg-indigo-500/10",  border: "border-indigo-500/30",  dot: "bg-indigo-500"  },
  kimi:            { label: "Kimi (Moonshot AI)",   shortLabel: "Kimi",     color: "text-cyan-600 dark:text-cyan-400",     bg: "bg-cyan-500/10",    border: "border-cyan-500/30",    dot: "bg-cyan-500"    },
  minimax:         { label: "MiniMax",              shortLabel: "MiniMax",  color: "text-pink-600 dark:text-pink-400",     bg: "bg-pink-500/10",    border: "border-pink-500/30",    dot: "bg-pink-500"    },
  mistral:         { label: "Mistral AI",           shortLabel: "Mistral",  color: "text-orange-600 dark:text-orange-400", bg: "bg-orange-500/10",  border: "border-orange-500/30",  dot: "bg-orange-500"  },
  zhipu:           { label: "Zhipu AI — GLM",       shortLabel: "GLM",      color: "text-sky-600 dark:text-sky-400",       bg: "bg-sky-500/10",     border: "border-sky-500/30",     dot: "bg-sky-500"     },
  meta:            { label: "Meta — Llama",         shortLabel: "Llama",    color: "text-blue-600 dark:text-blue-400",     bg: "bg-blue-500/10",    border: "border-blue-500/30",    dot: "bg-blue-500"    },
  "openai-oss":    { label: "OpenAI OSS",           shortLabel: "GPT-OSS",  color: "text-green-600 dark:text-green-400",   bg: "bg-green-500/10",   border: "border-green-500/30",   dot: "bg-green-500"   },
  qwen:            { label: "Alibaba — Qwen",       shortLabel: "Qwen",     color: "text-amber-600 dark:text-amber-400",   bg: "bg-amber-500/10",   border: "border-amber-500/30",   dot: "bg-amber-500"   },
};

export interface ModelPricing {
  inputPer1MTokens?: number;
  inputPer1MTokensOver200k?: number;
  outputPer1MTokens?: number;
  outputPer1MTokensOver200k?: number;
  thinkingPer1MTokens?: number;
  perImage?: number;
  perSecond?: number;
  inputPer1MChars?: number;
}

export interface ModelDef {
  id: string;
  displayName: string;
  category: ModelCategory;
  provider: ModelProvider;
  description: string;
  pricing: ModelPricing;
  isNew?: boolean;
  isPreview?: boolean;
  comingSoon?: boolean;
  supportsInpainting?: boolean;
}

export const MODELS: ModelDef[] = [
  // ─── Gemini 2.5 ───────────────────────────────────────────────
  { id: "gemini-2.5-pro",        displayName: "Gemini 2.5 Pro",        category: "text", provider: "google-gemini", description: "Advanced reasoning — 1M context, code & multimodal", pricing: { inputPer1MTokens: 1.25, outputPer1MTokens: 10.00 } },
  { id: "gemini-2.5-flash",      displayName: "Gemini 2.5 Flash",      category: "text", provider: "google-gemini", description: "Fast & capable — ideal for production workloads",     pricing: { inputPer1MTokens: 0.30, outputPer1MTokens:  2.50 } },
  { id: "gemini-2.5-flash-lite", displayName: "Gemini 2.5 Flash Lite", category: "text", provider: "google-gemini", description: "Ultra-affordable — high-volume & real-time tasks",     pricing: { inputPer1MTokens: 0.10, outputPer1MTokens:  0.40 } },
  // ─── Gemini 3.1 ───────────────────────────────────────────────
  { id: "gemini-3.1-pro-preview",         displayName: "Gemini 3.1 Pro Preview",         category: "text", provider: "google-gemini", description: "Most powerful agentic model — 1M context, strong coding & reasoning",   pricing: { inputPer1MTokens: 2.00, outputPer1MTokens: 12.00 }, isNew: true, isPreview: true },
  { id: "gemini-3.1-flash-lite-preview",  displayName: "Gemini 3.1 Flash Lite Preview",  category: "text", provider: "google-gemini", description: "Ultra-fast & cost-efficient — high-volume tasks on Gemini 3.1",         pricing: { inputPer1MTokens: 0.25, outputPer1MTokens:  1.50 }, isNew: true, isPreview: true },
  { id: "gemini-3.1-flash-image-preview", displayName: "Gemini 3.1 Flash Image Preview", category: "text", provider: "google-gemini", description: "Flash model with image generation — creative workflows & multi-turn",   pricing: { inputPer1MTokens: 0.50, outputPer1MTokens:  3.00 }, isNew: true, isPreview: true },
  // ─── Gemini 3.0 ───────────────────────────────────────────────
  { id: "gemini-3.0-pro-preview",         displayName: "Gemini 3 Pro Preview",           category: "text", provider: "google-gemini", description: "Powerful agentic model — multimodal understanding & coding",           pricing: { inputPer1MTokens: 2.00, outputPer1MTokens: 12.00 }, isNew: true, isPreview: true },
  { id: "gemini-3.0-flash-preview",       displayName: "Gemini 3 Flash Preview",          category: "text", provider: "google-gemini", description: "Workhorse model — near-Pro agentic, coding & multimodal at speed",    pricing: { inputPer1MTokens: 0.50, outputPer1MTokens:  3.00 }, isNew: true, isPreview: true },
  { id: "gemini-3.0-pro-image-preview",   displayName: "Gemini 3 Pro Image Preview",      category: "text", provider: "google-gemini", description: "Pro model upgraded for image generation & creative multi-turn editing", pricing: { inputPer1MTokens: 2.00, outputPer1MTokens: 12.00 }, isNew: true, isPreview: true },
  // ─── Imagen ───────────────────────────────────────────────────
  { id: "imagen-4.0-generate-001",       displayName: "Imagen 4",       category: "image", provider: "google-imagen", description: "Latest image generation — photorealistic quality",  pricing: { perImage: 0.04 }, isNew: true, isPreview: true },
  { id: "imagen-4.0-ultra-generate-001", displayName: "Imagen 4 Ultra", category: "image", provider: "google-imagen", description: "Highest-quality Imagen 4 — finest details",         pricing: { perImage: 0.06 }, isNew: true, isPreview: true },
  { id: "imagen-3.0-generate-002",       displayName: "Imagen 3",       category: "image", provider: "google-imagen", description: "Latest stable Imagen 3 — high-quality proven",      pricing: { perImage: 0.04 } },
  { id: "imagen-3.0-fast-generate-001",  displayName: "Imagen 3 Fast",  category: "image", provider: "google-imagen", description: "Faster Imagen 3 — lower cost for high-volume",      pricing: { perImage: 0.02 } },
  { id: "imagen-3.0-capability-001",     displayName: "Imagen 3 Edit",  category: "image", provider: "google-imagen", description: "Image editing & inpainting with mask support",      pricing: { perImage: 0.04 }, isNew: true, supportsInpainting: true },
  // ─── OpenAI Image-compatible aliases (mapped to Imagen) ──────
  { id: "dall-e-2",    displayName: "DALL-E 2 (→ Imagen 3 Fast)",         category: "image", provider: "google-imagen", description: "OpenAI alias — routes to imagen-3.0-fast-generate-001",  pricing: { perImage: 0.02 } },
  { id: "dall-e-3",    displayName: "DALL-E 3 (→ Imagen 4)",              category: "image", provider: "google-imagen", description: "OpenAI alias — routes to imagen-4.0-generate-001",       pricing: { perImage: 0.04 } },
  { id: "gpt-image-1", displayName: "GPT Image 1 (→ Imagen 4 Ultra)",     category: "image", provider: "google-imagen", description: "OpenAI alias — routes to imagen-4.0-ultra-generate-001", pricing: { perImage: 0.06 } },
  // ─── Veo ──────────────────────────────────────────────────────
  { id: "veo-3.1-generate-001",      displayName: "Veo 3.1",      category: "video", provider: "google-veo", description: "Latest video generation — cinematic with audio", pricing: { perSecond: 0.40 }, isNew: true },
  { id: "veo-3.1-fast-generate-001", displayName: "Veo 3.1 Fast", category: "video", provider: "google-veo", description: "Faster Veo 3.1 — lower latency",                pricing: { perSecond: 0.12 }, isNew: true },
  { id: "veo-3.0-generate-001",      displayName: "Veo 3",        category: "video", provider: "google-veo", description: "Previous Veo 3 — stable and reliable",           pricing: { perSecond: 0.40 } },
  { id: "veo-2.0-generate-001",      displayName: "Veo 2",        category: "video", provider: "google-veo", description: "High-quality video — proven reliability",        pricing: { perSecond: 0.50 } },
  // ─── Grok / xAI ───────────────────────────────────────────────
  { id: "grok-4.20",         displayName: "Grok 4.20",         category: "text", provider: "xai", description: "Latest Grok model — non-reasoning, low latency", pricing: { inputPer1MTokens: 0.20, outputPer1MTokens: 0.50 }, isNew: true },
  { id: "grok-4.1-fast",     displayName: "Grok 4.1 Fast",     category: "text", provider: "xai", description: "Fast Grok 4.1 — low-latency reasoning",          pricing: { inputPer1MTokens: 0.20, outputPer1MTokens: 0.50 }, comingSoon: true },
  { id: "grok-4.1-thinking", displayName: "Grok 4.1 Thinking", category: "text", provider: "xai", description: "Extended thinking — advanced reasoning",          pricing: { inputPer1MTokens: 0.20, outputPer1MTokens: 0.50 } },
  // ─── Mistral AI ───────────────────────────────────────────────
  { id: "codestral-2",     displayName: "Codestral 2",      category: "text", provider: "mistral", description: "Latest Codestral — advanced code generation",    pricing: { inputPer1MTokens: 0.30, outputPer1MTokens: 0.90 }, isNew: true, comingSoon: true },
  { id: "mistral-large-3", displayName: "Mistral Large 3",  category: "text", provider: "mistral", description: "Most powerful Mistral — complex tasks",           pricing: { inputPer1MTokens: 2.00, outputPer1MTokens: 6.00 }, isNew: true, comingSoon: true },
  { id: "mistral-medium-3",displayName: "Mistral Medium 3", category: "text", provider: "mistral", description: "Balanced performance and cost",                   pricing: { inputPer1MTokens: 0.40, outputPer1MTokens: 2.00 }, isNew: true, comingSoon: true },
  { id: "mistral-small",   displayName: "Mistral Small 3.1", category: "text", provider: "mistral", description: "Mistral Small 3.1 (25.03) — fast & affordable via Vertex AI MaaS", pricing: { inputPer1MTokens: 0.10, outputPer1MTokens: 0.30 }, isNew: true },
  { id: "ministral-3",     displayName: "Ministral 3B",     category: "text", provider: "mistral", description: "Ultra-lightweight — ideal for high-volume tasks", pricing: { inputPer1MTokens: 0.10, outputPer1MTokens: 0.30 }, isNew: true, comingSoon: true },
  { id: "codestral",       displayName: "Codestral",        category: "text", provider: "mistral", description: "Specialized for code generation",                 pricing: { inputPer1MTokens: 0.30, outputPer1MTokens: 0.90 }, comingSoon: true },
  { id: "jamba-large",     displayName: "Jamba Large",      category: "text", provider: "mistral", description: "AI21 Jamba — hybrid SSM/Transformer architecture", pricing: { inputPer1MTokens: 2.00, outputPer1MTokens: 8.00 }, isNew: true, comingSoon: true },
  // ─── DeepSeek ─────────────────────────────────────────────────
  { id: "deepseek-v3.2",   displayName: "DeepSeek V3.2",    category: "text", provider: "deepseek", description: "Latest DeepSeek flagship model",              pricing: { inputPer1MTokens: 0.56, outputPer1MTokens: 1.68 }, isNew: true },
  { id: "deepseek-r1-0529",displayName: "DeepSeek R1 0529", category: "text", provider: "deepseek", description: "Latest R1 reasoning — improved accuracy (May 29)",pricing: { inputPer1MTokens: 1.35, outputPer1MTokens: 5.40 }, isNew: true, comingSoon: true },
  { id: "deepseek-r1-0528",displayName: "DeepSeek R1 0528", category: "text", provider: "deepseek", description: "R1 reasoning snapshot — May 28 release",        pricing: { inputPer1MTokens: 1.35, outputPer1MTokens: 5.40 }, comingSoon: true },
  { id: "deepseek-r1",     displayName: "DeepSeek R1",      category: "text", provider: "deepseek", description: "Chain-of-thought reasoning model",             pricing: { inputPer1MTokens: 1.35, outputPer1MTokens: 5.40 }, isNew: true, comingSoon: true },
  { id: "deepseek-ocr",    displayName: "DeepSeek OCR",     category: "text", provider: "deepseek", description: "Specialized OCR & document understanding",    pricing: { inputPer1MTokens: 0.30, outputPer1MTokens: 1.20 }, isNew: true, comingSoon: true },
  // ─── Google Gemma MaaS ────────────────────────────────────────
  { id: "gemma-4-26b", displayName: "Gemma 4 26B", category: "text", provider: "google-gemma", description: "Open Gemma model served via Vertex MaaS", pricing: { inputPer1MTokens: 0.20, outputPer1MTokens: 0.80 }, isNew: true },
  // ─── GLM / Zhipu AI ───────────────────────────────────────────
  { id: "glm-5",   displayName: "GLM-5",   category: "text", provider: "zhipu", description: "Zhipu AI — agentic coding & engineering model", pricing: { inputPer1MTokens: 0.50, outputPer1MTokens: 1.50 }, isNew: true },
  { id: "glm-5.1", displayName: "GLM-5.1", category: "text", provider: "zhipu", description: "GLM-5.1 FP8 — efficient quantized variant",     pricing: { inputPer1MTokens: 0.50, outputPer1MTokens: 1.50 }, isNew: true, comingSoon: true },
  // ─── Kimi / Moonshot AI ───────────────────────────────────────
  { id: "kimi-k2",   displayName: "Kimi K2",   category: "text", provider: "kimi", description: "Moonshot AI powerful thinking model",          pricing: { inputPer1MTokens: 0.60, outputPer1MTokens: 2.50 }, isNew: true },
  // ─── Llama / Meta ─────────────────────────────────────────────
  { id: "llama-4-maverick",displayName: "Llama 4 Maverick",category: "text", provider: "meta", description: "Meta's multimodal flagship model", pricing: { inputPer1MTokens: 0.35, outputPer1MTokens: 1.15 }, isNew: true, comingSoon: true },
  { id: "llama-4-scout",   displayName: "Llama 4 Scout",   category: "text", provider: "meta", description: "Efficient multimodal model",        pricing: { inputPer1MTokens: 0.25, outputPer1MTokens: 0.70 }, isNew: true, comingSoon: true },
  { id: "llama-3.3",       displayName: "Llama 3.3 70B",   category: "text", provider: "meta", description: "Versatile 70B instruction model",   pricing: { inputPer1MTokens: 0.72, outputPer1MTokens: 0.72 }, comingSoon: true },
  // ─── MiniMax ──────────────────────────────────────────────────
  { id: "minimax-m2",   displayName: "MiniMax M2",   category: "text", provider: "minimax", description: "Long-context multimodal reasoning model", pricing: { inputPer1MTokens: 0.30, outputPer1MTokens: 1.20 }, isNew: true },
  // ─── OpenAI OSS ───────────────────────────────────────────────
  { id: "gpt-oss-120b", displayName: "GPT-OSS 120B", category: "text", provider: "openai-oss", description: "OpenAI open model — 120B parameters", pricing: { inputPer1MTokens: 0.09, outputPer1MTokens: 0.36 }, isNew: true, comingSoon: true },
  // ─── Qwen / Alibaba Cloud ─────────────────────────────────────
  { id: "qwen3-235b", displayName: "Qwen3 235B", category: "text", provider: "qwen", description: "Large MoE model — complex reasoning", pricing: { inputPer1MTokens: 0.22, outputPer1MTokens: 0.88 }, isNew: true, comingSoon: true },
  // ─── Audio (Google Cloud TTS / STT) ─────────────────────────
  { id: "tts-1",     displayName: "TTS-1 (→ Google Standard)",      category: "audio", provider: "google-gemini", description: "Text-to-speech — Google Standard voices, OpenAI-compatible",  pricing: { inputPer1MChars: 4.00 }, isNew: true },
  { id: "tts-1-hd",  displayName: "TTS-1-HD (→ Google Studio/HD)",   category: "audio", provider: "google-gemini", description: "Text-to-speech — Studio/Chirp HD voices, premium quality",     pricing: { inputPer1MChars: 16.00 }, isNew: true },
  { id: "whisper-1", displayName: "Whisper-1 (→ Chirp 2)",           category: "audio", provider: "google-gemini", description: "Speech-to-text — Google Chirp 2, OpenAI-compatible",            pricing: { perSecond: 0.0004 }, isNew: true },
];

export const MODEL_IDS = MODELS.map((m) => m.id);

export const TEXT_MODELS = MODELS.filter((m) => m.category === "text");
export const IMAGE_MODELS = MODELS.filter((m) => m.category === "image");
export const VIDEO_MODELS = MODELS.filter((m) => m.category === "video");
export const AUDIO_MODELS = MODELS.filter((m) => m.category === "audio");

export function getModel(id: string): ModelDef | undefined {
  return MODELS.find((m) => m.id === id);
}

export function formatModelPricing(m: ModelDef): string {
  const p = m.pricing;
  if (p.inputPer1MTokens !== undefined) {
    return `$${p.inputPer1MTokens}/1M in · $${p.outputPer1MTokens}/1M out`;
  }
  if (p.perImage !== undefined) return `$${p.perImage}/image`;
  if (p.inputPer1MChars !== undefined) return `$${p.inputPer1MChars}/1M chars`;
  if (p.perSecond !== undefined) return `$${p.perSecond}/sec`;
  return "Custom pricing";
}

export function getProviderModels(provider: ModelProvider): ModelDef[] {
  return MODELS.filter((m) => m.provider === provider);
}

export const ALL_PROVIDERS = Object.keys(PROVIDER_META) as ModelProvider[];
