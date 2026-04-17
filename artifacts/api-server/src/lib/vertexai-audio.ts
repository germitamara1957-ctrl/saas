import { getActiveProvider, getAccessToken } from "./vertexai-provider";

// ─── Voice mappings ──────────────────────────────────────────────────────────
// OpenAI voice names → Google Cloud TTS voice names.
// We pick neutral, high-quality voices.  Standard tier maps to Neural2,
// HD tier maps to Studio voices.
const STANDARD_VOICES: Record<string, { en: string; ar: string }> = {
  alloy:   { en: "en-US-Neural2-A", ar: "ar-XA-Standard-B" },
  echo:    { en: "en-US-Neural2-D", ar: "ar-XA-Standard-C" },
  fable:   { en: "en-US-Neural2-J", ar: "ar-XA-Standard-D" },
  onyx:    { en: "en-US-Neural2-F", ar: "ar-XA-Standard-A" },
  nova:    { en: "en-US-Neural2-H", ar: "ar-XA-Standard-D" },
  shimmer: { en: "en-US-Neural2-C", ar: "ar-XA-Standard-A" },
};

const HD_VOICES: Record<string, { en: string; ar: string }> = {
  alloy:   { en: "en-US-Studio-O", ar: "ar-XA-Wavenet-B" },
  echo:    { en: "en-US-Studio-Q", ar: "ar-XA-Wavenet-C" },
  fable:   { en: "en-US-Studio-O", ar: "ar-XA-Wavenet-D" },
  onyx:    { en: "en-US-Studio-Q", ar: "ar-XA-Wavenet-A" },
  nova:    { en: "en-US-Studio-O", ar: "ar-XA-Wavenet-D" },
  shimmer: { en: "en-US-Studio-O", ar: "ar-XA-Wavenet-A" },
};

const FORMAT_TO_ENCODING: Record<string, string> = {
  mp3:  "MP3",
  opus: "OGG_OPUS",
  aac:  "MP3",     // Google TTS doesn't support AAC; fall back to MP3
  flac: "LINEAR16", // Approximate — return raw PCM as wav-like
  wav:  "LINEAR16",
  pcm:  "LINEAR16",
};

function isArabic(text: string): boolean {
  return /[\u0600-\u06FF]/.test(text);
}

/**
 * Synthesize speech using Google Cloud Text-to-Speech REST API.
 * Returns the raw audio bytes (already decoded from the API's base64 response).
 */
export async function synthesizeSpeech(opts: {
  model: string;
  text: string;
  voice?: string;
  format?: string;
  speed?: number;
}): Promise<{ bytes: Buffer; mimeType: string; characters: number }> {
  const provider = await getActiveProvider();
  const token = await getAccessToken(provider);

  const tier = opts.model === "tts-1-hd" ? "hd" : "standard";
  const voiceTable = tier === "hd" ? HD_VOICES : STANDARD_VOICES;
  const voiceName = (opts.voice ?? "alloy").toLowerCase();
  const voiceMap = voiceTable[voiceName] ?? voiceTable.alloy!;

  const lang = isArabic(opts.text) ? "ar" : "en";
  const voice = lang === "ar" ? voiceMap.ar : voiceMap.en;
  const languageCode = lang === "ar" ? "ar-XA" : "en-US";

  const fmt = (opts.format ?? "mp3").toLowerCase();
  const audioEncoding = FORMAT_TO_ENCODING[fmt] ?? "MP3";
  const mimeType =
    audioEncoding === "MP3"      ? "audio/mpeg" :
    audioEncoding === "OGG_OPUS" ? "audio/ogg"  :
    "audio/wav";

  const speakingRate = Math.max(0.25, Math.min(4.0, opts.speed ?? 1.0));

  const response = await fetch("https://texttospeech.googleapis.com/v1/text:synthesize", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      input: { text: opts.text },
      voice: { languageCode, name: voice },
      audioConfig: { audioEncoding, speakingRate },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Google TTS error: ${response.status} ${err.slice(0, 300)}`);
  }

  const data = (await response.json()) as { audioContent?: string };
  if (!data.audioContent) {
    throw new Error("Google TTS returned no audio content");
  }

  return {
    bytes: Buffer.from(data.audioContent, "base64"),
    mimeType,
    characters: opts.text.length,
  };
}

const MIME_TO_STT_ENCODING: Record<string, string> = {
  "audio/mpeg":  "MP3",
  "audio/mp3":   "MP3",
  "audio/wav":   "LINEAR16",
  "audio/x-wav": "LINEAR16",
  "audio/flac":  "FLAC",
  "audio/ogg":   "OGG_OPUS",
  "audio/webm":  "WEBM_OPUS",
  "audio/m4a":   "MP3",
  "audio/x-m4a": "MP3",
  "audio/aac":   "MP3",
};

/**
 * Transcribe audio using Google Cloud Speech-to-Text v1.
 * Accepts raw audio bytes + mime type.  Returns { text, durationSeconds }.
 */
export async function transcribeAudio(opts: {
  audio: Buffer;
  mimeType: string;
  language?: string;
}): Promise<{ text: string; durationSeconds: number; language: string }> {
  const provider = await getActiveProvider();
  const token = await getAccessToken(provider);

  const encoding = MIME_TO_STT_ENCODING[opts.mimeType.toLowerCase()] ?? "ENCODING_UNSPECIFIED";

  // Pick a sensible default language; client can override
  const languageCode = opts.language ?? "en-US";
  const alt = languageCode.startsWith("ar") ? ["en-US"] : ["ar-XA"];

  const config: Record<string, unknown> = {
    languageCode,
    alternativeLanguageCodes: alt,
    enableAutomaticPunctuation: true,
    model: "latest_long",
  };
  if (encoding !== "ENCODING_UNSPECIFIED") {
    config.encoding = encoding;
  }

  const response = await fetch("https://speech.googleapis.com/v1/speech:recognize", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      config,
      audio: { content: opts.audio.toString("base64") },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Google STT error: ${response.status} ${err.slice(0, 300)}`);
  }

  const data = (await response.json()) as {
    results?: Array<{
      alternatives?: Array<{ transcript?: string }>;
      resultEndTime?: string;
      languageCode?: string;
    }>;
    totalBilledTime?: string;
  };

  const text = (data.results ?? [])
    .map((r) => r.alternatives?.[0]?.transcript ?? "")
    .join(" ")
    .trim();

  // Parse "12.300s" → 12.3
  const billedRaw = data.totalBilledTime ?? data.results?.[data.results.length - 1]?.resultEndTime ?? "0s";
  const durationSeconds = Number.parseFloat(String(billedRaw).replace("s", "")) || 0;

  return {
    text,
    durationSeconds: Math.max(durationSeconds, 1),
    language: data.results?.[0]?.languageCode ?? languageCode,
  };
}
