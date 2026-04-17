import { type ChatMessage, type ChatResult, OPENAI_COMPAT_IDS, MISTRAL_RAW_PREDICT_IDS } from "./vertexai-types";
import { getActiveProvider, getAccessToken, type ResolvedProvider } from "./vertexai-provider";

interface OpenAIMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

function toOpenAIMessages(messages: ChatMessage[]): OpenAIMessage[] {
  return messages.map((m) => {
    const role = m.role === "model" ? "assistant" : "user";
    const content = typeof m.content === "string"
      ? m.content
      : m.content.filter((p) => p.type === "text").map((p) => (p as { type: "text"; text: string }).text).join("\n");
    return { role, content };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// OpenAI-compat MaaS endpoint (global) — used by Grok, DeepSeek, Kimi, etc.
// ─────────────────────────────────────────────────────────────────────────────

function resolveOpenAICompatId(model: string): string {
  const normalised = model.toLowerCase().trim();
  return OPENAI_COMPAT_IDS[normalised] ?? normalised;
}

function buildOpenAICompatUrl(provider: ResolvedProvider): string {
  return (
    `https://aiplatform.googleapis.com/v1/projects/${provider.projectId}` +
    `/locations/global/endpoints/openapi/chat/completions`
  );
}

export async function chatWithOpenAICompat(
  model: string,
  messages: ChatMessage[],
  options?: { temperature?: number; maxOutputTokens?: number },
): Promise<ChatResult> {
  const provider = await getActiveProvider();
  const token = await getAccessToken(provider);
  const url = buildOpenAICompatUrl(provider);
  const vertexModel = resolveOpenAICompatId(model);

  const body: Record<string, unknown> = {
    model: vertexModel,
    messages: toOpenAIMessages(messages),
  };
  if (options?.temperature !== undefined) body.temperature = options.temperature;
  if (options?.maxOutputTokens !== undefined) body.max_tokens = options.maxOutputTokens;

  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`${model} API error: ${response.status} ${err}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null; reasoning_content?: string | null } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const msg = data.choices?.[0]?.message;
  // Some thinking models (e.g. GLM-5) return content=null and put the answer in
  // reasoning_content when max_tokens is tight. Fall back gracefully.
  const content = (msg?.content ?? null) || (msg?.reasoning_content ?? "") || "";
  return {
    content,
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
  };
}

export async function* streamChatWithOpenAICompat(
  model: string,
  messages: ChatMessage[],
  options?: { temperature?: number; maxOutputTokens?: number; signal?: AbortSignal },
): AsyncGenerator<{ type: "delta"; text: string } | { type: "done"; inputTokens: number; outputTokens: number }> {
  const provider = await getActiveProvider();
  const token = await getAccessToken(provider);
  const url = buildOpenAICompatUrl(provider);
  const vertexModel = resolveOpenAICompatId(model);

  const body: Record<string, unknown> = {
    model: vertexModel,
    messages: toOpenAIMessages(messages),
    stream: true,
    stream_options: { include_usage: true },
  };
  if (options?.temperature !== undefined) body.temperature = options.temperature;
  if (options?.maxOutputTokens !== undefined) body.max_tokens = options.maxOutputTokens;

  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: options?.signal,
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`${model} streaming error: ${response.status} ${err}`);
  }

  if (!response.body) throw new Error(`No response body from ${model} streaming`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    while (true) {
      if (options?.signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (!raw || raw === "[DONE]") continue;

        let chunk: Record<string, unknown>;
        try { chunk = JSON.parse(raw); } catch { continue; }

        const choices = chunk["choices"] as Array<Record<string, unknown>> | undefined;
        if (choices?.length) {
          const delta = choices[0]["delta"] as Record<string, unknown> | undefined;
          // Use content if present; fall back to reasoning_content (e.g. GLM-5 thinking model)
          const text = (delta?.["content"] as string | undefined)
            ?? (delta?.["reasoning_content"] as string | undefined);
          if (text) yield { type: "delta", text };
        }

        const usage = chunk["usage"] as Record<string, unknown> | undefined;
        if (usage) {
          inputTokens = (usage["prompt_tokens"] as number | undefined) ?? inputTokens;
          outputTokens = (usage["completion_tokens"] as number | undefined) ?? outputTokens;
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }

  yield { type: "done", inputTokens, outputTokens };
}

// ─────────────────────────────────────────────────────────────────────────────
// Mistral rawPredict endpoint — regional, publisher: mistralai
//
// URL (non-streaming):
//   https://{location}-aiplatform.googleapis.com/v1/projects/{project}
//     /locations/{location}/publishers/mistralai/models/{modelId}:rawPredict
//
// URL (streaming):
//   https://{location}-aiplatform.googleapis.com/v1/projects/{project}
//     /locations/{location}/publishers/mistralai/models/{modelId}:streamRawPredict
//
// Request/response format is OpenAI-compatible.
// ─────────────────────────────────────────────────────────────────────────────

function resolveMistralModelId(model: string): string {
  const normalised = model.toLowerCase().trim();
  return MISTRAL_RAW_PREDICT_IDS[normalised] ?? normalised;
}

function buildMistralUrl(provider: ResolvedProvider, modelId: string, stream: boolean): string {
  const loc = provider.location || "us-central1";
  const action = stream ? "streamRawPredict" : "rawPredict";
  return (
    `https://${loc}-aiplatform.googleapis.com/v1/projects/${provider.projectId}` +
    `/locations/${loc}/publishers/mistralai/models/${modelId}:${action}`
  );
}

export async function chatWithMistralRawPredict(
  model: string,
  messages: ChatMessage[],
  options?: { temperature?: number; maxOutputTokens?: number },
): Promise<ChatResult> {
  const provider = await getActiveProvider();
  const token = await getAccessToken(provider);
  const mistralModelId = resolveMistralModelId(model);
  const url = buildMistralUrl(provider, mistralModelId, false);

  const body: Record<string, unknown> = {
    model: mistralModelId,
    messages: toOpenAIMessages(messages),
  };
  if (options?.temperature !== undefined) body.temperature = options.temperature;
  if (options?.maxOutputTokens !== undefined) body.max_tokens = options.maxOutputTokens;

  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`${model} API error: ${response.status} ${err}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const content = data.choices?.[0]?.message?.content ?? "";
  return {
    content,
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
  };
}

export async function* streamChatWithMistralRawPredict(
  model: string,
  messages: ChatMessage[],
  options?: { temperature?: number; maxOutputTokens?: number; signal?: AbortSignal },
): AsyncGenerator<{ type: "delta"; text: string } | { type: "done"; inputTokens: number; outputTokens: number }> {
  const provider = await getActiveProvider();
  const token = await getAccessToken(provider);
  const mistralModelId = resolveMistralModelId(model);
  const url = buildMistralUrl(provider, mistralModelId, true);

  const body: Record<string, unknown> = {
    model: mistralModelId,
    messages: toOpenAIMessages(messages),
    stream: true,
  };
  if (options?.temperature !== undefined) body.temperature = options.temperature;
  if (options?.maxOutputTokens !== undefined) body.max_tokens = options.maxOutputTokens;

  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: options?.signal,
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`${model} streaming error: ${response.status} ${err}`);
  }

  if (!response.body) throw new Error(`No response body from ${model} streaming`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    while (true) {
      if (options?.signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (!raw || raw === "[DONE]") continue;

        let chunk: Record<string, unknown>;
        try { chunk = JSON.parse(raw); } catch { continue; }

        const choices = chunk["choices"] as Array<Record<string, unknown>> | undefined;
        if (choices?.length) {
          const delta = choices[0]["delta"] as Record<string, unknown> | undefined;
          const text = delta?.["content"] as string | undefined;
          if (text) yield { type: "delta", text };
        }

        const usage = chunk["usage"] as Record<string, unknown> | undefined;
        if (usage) {
          inputTokens = (usage["prompt_tokens"] as number | undefined) ?? inputTokens;
          outputTokens = (usage["completion_tokens"] as number | undefined) ?? outputTokens;
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }

  yield { type: "done", inputTokens, outputTokens };
}
