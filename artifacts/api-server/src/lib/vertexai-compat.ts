import {
  type ChatMessage,
  type ChatResult,
  type ChatOptions,
  type StreamEvent,
  type ToolCall,
  type FinishReason,
  OPENAI_COMPAT_IDS,
  MISTRAL_RAW_PREDICT_IDS,
} from "./vertexai-types";
import { withVertexProvider, withVertexProviderStream, getAccessToken, type ResolvedProvider } from "./vertexai-provider";

type OpenAIContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

interface OpenAIMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string | OpenAIContentPart[] | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

function mapRoleToOpenAI(role: ChatMessage["role"]): OpenAIMessage["role"] {
  if (role === "model") return "assistant";
  if (role === "system" || role === "tool") return role;
  return "user";
}

/**
 * Converts our internal ChatMessage[] to OpenAI-compatible messages.
 * Multimodal-capable partner models (Claude, Llama Vision, Pixtral, Grok, Gemma,
 * GLM, etc.) accept the standard OpenAI `image_url` format with data URLs.
 * Anything that's not text or an image is dropped here — the chat route blocks
 * non-image binary parts upstream so we never silently lose user content.
 *
 * Tool fields (tool_calls, tool_call_id, name) are forwarded as-is — the
 * upstream MaaS endpoint speaks the OpenAI tools format natively.
 */
function toOpenAIMessages(messages: ChatMessage[]): OpenAIMessage[] {
  return messages.map((m) => {
    const role = mapRoleToOpenAI(m.role);
    const out: OpenAIMessage = { role, content: null };

    if (m.content === null) {
      out.content = null;
    } else if (typeof m.content === "string") {
      out.content = m.content;
    } else {
      const parts: OpenAIContentPart[] = [];
      for (const p of m.content) {
        if ("text" in p) {
          parts.push({ type: "text", text: p.text });
        } else if (p.mimeType.startsWith("image/")) {
          parts.push({
            type: "image_url",
            image_url: { url: `data:${p.mimeType};base64,${p.base64}` },
          });
        }
      }
      out.content = parts.length === 1 && parts[0]!.type === "text" ? parts[0]!.text : parts;
    }

    if (m.tool_calls && m.tool_calls.length) out.tool_calls = m.tool_calls;
    if (m.tool_call_id) out.tool_call_id = m.tool_call_id;
    if (m.name) out.name = m.name;
    return out;
  });
}

function applyChatOptions(body: Record<string, unknown>, options?: ChatOptions): void {
  if (options?.temperature !== undefined) body.temperature = options.temperature;
  if (options?.maxOutputTokens !== undefined) body.max_tokens = options.maxOutputTokens;
  if (options?.tools && options.tools.length > 0) {
    body.tools = options.tools;
    if (options.toolChoice !== undefined) body.tool_choice = options.toolChoice;
    if (options.parallelToolCalls !== undefined) body.parallel_tool_calls = options.parallelToolCalls;
  }
}

function mapFinishReason(raw: string | null | undefined): FinishReason {
  switch (raw) {
    case "tool_calls":
    case "function_call":
      return "tool_calls";
    case "length":
    case "max_tokens":
      return "length";
    case "content_filter":
      return "content_filter";
    case "stop":
    case "end_turn":
    case null:
    case undefined:
      return "stop";
    default:
      return "stop";
  }
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
  options?: ChatOptions,
): Promise<ChatResult> {
  return withVertexProvider(async (provider) => {
    const token = await getAccessToken(provider);
    const url = buildOpenAICompatUrl(provider);
    const vertexModel = resolveOpenAICompatId(model);

    const body: Record<string, unknown> = {
      model: vertexModel,
      messages: toOpenAIMessages(messages),
    };
    applyChatOptions(body, options);

    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: options?.signal,
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`${model} API error: ${response.status} ${err}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string | null;
          reasoning_content?: string | null;
          tool_calls?: ToolCall[];
        };
        finish_reason?: string | null;
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const choice = data.choices?.[0];
    const msg = choice?.message;
    const content = (msg?.content ?? null) || (msg?.reasoning_content ?? "") || "";
    const toolCalls = msg?.tool_calls && msg.tool_calls.length ? msg.tool_calls : undefined;

    return {
      content,
      toolCalls,
      finishReason: mapFinishReason(choice?.finish_reason),
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
    };
  });
}

export async function* streamChatWithOpenAICompat(
  model: string,
  messages: ChatMessage[],
  options?: ChatOptions,
): AsyncGenerator<StreamEvent> {
  const it = await withVertexProviderStream<StreamEvent>(async (provider) => {
    const token = await getAccessToken(provider);
    const url = buildOpenAICompatUrl(provider);
    const vertexModel = resolveOpenAICompatId(model);

    const body: Record<string, unknown> = {
      model: vertexModel,
      messages: toOpenAIMessages(messages),
      stream: true,
      stream_options: { include_usage: true },
    };
    applyChatOptions(body, options);

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

    return streamOpenAICompatBody(response, options);
  });
  yield* it;
}

interface StreamingToolCall {
  index: number;
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

async function* streamOpenAICompatBody(
  response: Response,
  options?: { signal?: AbortSignal },
): AsyncGenerator<StreamEvent> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let finishReason: FinishReason = "stop";
  // Accumulate tool calls across deltas so we can emit them on `done`.
  const toolCallsByIndex: Record<number, { id: string; name: string; arguments: string }> = {};

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
          const choice0 = choices[0]!;
          const delta = choice0["delta"] as Record<string, unknown> | undefined;
          const text = (delta?.["content"] as string | undefined)
            ?? (delta?.["reasoning_content"] as string | undefined);
          if (text) yield { type: "delta", text };

          const toolDeltas = delta?.["tool_calls"] as StreamingToolCall[] | undefined;
          if (toolDeltas?.length) {
            for (const td of toolDeltas) {
              const idx = td.index;
              const existing = toolCallsByIndex[idx] ?? { id: "", name: "", arguments: "" };
              if (td.id) existing.id = td.id;
              if (td.function?.name) existing.name += td.function.name;
              if (td.function?.arguments) existing.arguments += td.function.arguments;
              toolCallsByIndex[idx] = existing;

              yield {
                type: "tool_call_delta",
                index: idx,
                id: td.id,
                name: td.function?.name,
                argumentsDelta: td.function?.arguments,
              };
            }
          }

          const fr = choice0["finish_reason"] as string | null | undefined;
          if (fr) finishReason = mapFinishReason(fr);
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

  const indices = Object.keys(toolCallsByIndex).map(Number).sort((a, b) => a - b);
  const toolCalls: ToolCall[] | undefined = indices.length
    ? indices.map((i) => {
        const t = toolCallsByIndex[i]!;
        return {
          id: t.id || `call_${i}`,
          type: "function" as const,
          function: { name: t.name, arguments: t.arguments || "{}" },
        };
      })
    : undefined;

  if (toolCalls && finishReason === "stop") finishReason = "tool_calls";

  yield { type: "done", inputTokens, outputTokens, finishReason, toolCalls };
}

// ─────────────────────────────────────────────────────────────────────────────
// Mistral rawPredict endpoint — regional, publisher: mistralai
// Request/response format is OpenAI-compatible (including tools).
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
  options?: ChatOptions,
): Promise<ChatResult> {
  return withVertexProvider(async (provider) => {
    const token = await getAccessToken(provider);
    const mistralModelId = resolveMistralModelId(model);
    const url = buildMistralUrl(provider, mistralModelId, false);

    const body: Record<string, unknown> = {
      model: mistralModelId,
      messages: toOpenAIMessages(messages),
    };
    applyChatOptions(body, options);

    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: options?.signal,
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`${model} API error: ${response.status} ${err}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{
        message?: { content?: string | null; tool_calls?: ToolCall[] };
        finish_reason?: string | null;
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const choice = data.choices?.[0];
    const msg = choice?.message;
    const toolCalls = msg?.tool_calls && msg.tool_calls.length ? msg.tool_calls : undefined;

    return {
      content: msg?.content ?? "",
      toolCalls,
      finishReason: mapFinishReason(choice?.finish_reason),
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
    };
  });
}

export async function* streamChatWithMistralRawPredict(
  model: string,
  messages: ChatMessage[],
  options?: ChatOptions,
): AsyncGenerator<StreamEvent> {
  const it = await withVertexProviderStream<StreamEvent>(async (provider) => {
    const token = await getAccessToken(provider);
    const mistralModelId = resolveMistralModelId(model);
    const url = buildMistralUrl(provider, mistralModelId, true);

    const body: Record<string, unknown> = {
      model: mistralModelId,
      messages: toOpenAIMessages(messages),
      stream: true,
    };
    applyChatOptions(body, options);

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

    return streamOpenAICompatBody(response, options);
  });
  yield* it;
}
