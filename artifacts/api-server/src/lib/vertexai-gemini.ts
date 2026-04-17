import { type ChatMessage, type ChatResult, GEMINI_GLOBAL_LOCATION_MODELS } from "./vertexai-types";
import { resolveVertexModelId } from "./vertexai-types";
import { getActiveProvider, buildVertexAIForModel, getAccessToken, type ResolvedProvider } from "./vertexai-provider";

type GeminiRestPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

interface GeminiRestContent {
  role: string;
  parts: GeminiRestPart[];
}

function toGeminiContents(messages: ChatMessage[]): GeminiRestContent[] {
  return messages.map((m) => {
    if (typeof m.content === "string") {
      return { role: m.role, parts: [{ text: m.content }] };
    }
    const parts: GeminiRestPart[] = m.content.map((part) => {
      if (part.type === "text") return { text: part.text };
      return { inlineData: { mimeType: part.mimeType, data: part.base64 } };
    });
    return { role: m.role, parts };
  });
}

async function chatWithGeminiGlobal(
  provider: ResolvedProvider,
  vertexModel: string,
  messages: ChatMessage[],
  options?: { temperature?: number; maxOutputTokens?: number },
): Promise<ChatResult> {
  const token = await getAccessToken(provider);
  const url =
    `https://aiplatform.googleapis.com/v1/projects/${provider.projectId}` +
    `/locations/global/publishers/google/models/${vertexModel}:generateContent`;

  const body: Record<string, unknown> = { contents: toGeminiContents(messages) };
  const config: Record<string, unknown> = {};
  if (options?.temperature !== undefined) config.temperature = options.temperature;
  if (options?.maxOutputTokens !== undefined) config.maxOutputTokens = options.maxOutputTokens;
  if (Object.keys(config).length) body.generationConfig = config;

  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`${vertexModel} API error: ${response.status} ${err}`);
  }

  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };

  return {
    content: data.candidates?.[0]?.content?.parts?.[0]?.text ?? "",
    inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
  };
}

async function* streamChatWithGeminiGlobal(
  provider: ResolvedProvider,
  vertexModel: string,
  messages: ChatMessage[],
  options?: { temperature?: number; maxOutputTokens?: number; signal?: AbortSignal },
): AsyncGenerator<{ type: "delta"; text: string } | { type: "done"; inputTokens: number; outputTokens: number }> {
  const token = await getAccessToken(provider);
  const url =
    `https://aiplatform.googleapis.com/v1/projects/${provider.projectId}` +
    `/locations/global/publishers/google/models/${vertexModel}:streamGenerateContent?alt=sse`;

  const body: Record<string, unknown> = { contents: toGeminiContents(messages) };
  const config: Record<string, unknown> = {};
  if (options?.temperature !== undefined) config.temperature = options.temperature;
  if (options?.maxOutputTokens !== undefined) config.maxOutputTokens = options.maxOutputTokens;
  if (Object.keys(config).length) body.generationConfig = config;

  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: options?.signal,
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`${vertexModel} streaming error: ${response.status} ${err}`);
  }

  if (!response.body) throw new Error(`No response body from ${vertexModel} streaming`);

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

        const candidates = chunk["candidates"] as Array<Record<string, unknown>> | undefined;
        if (candidates?.length) {
          const content = candidates[0]["content"] as Record<string, unknown> | undefined;
          const parts = content?.["parts"] as Array<Record<string, unknown>> | undefined;
          const text = parts?.[0]?.["text"] as string | undefined;
          if (text) yield { type: "delta", text };
        }

        const usage = chunk["usageMetadata"] as Record<string, unknown> | undefined;
        if (usage) {
          inputTokens = (usage["promptTokenCount"] as number | undefined) ?? inputTokens;
          outputTokens = (usage["candidatesTokenCount"] as number | undefined) ?? outputTokens;
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }

  yield { type: "done", inputTokens, outputTokens };
}

export async function chatWithGemini(
  model: string,
  messages: ChatMessage[],
  options?: { temperature?: number; maxOutputTokens?: number },
): Promise<ChatResult> {
  const provider = await getActiveProvider();
  const vertexModel = resolveVertexModelId(model);

  if (GEMINI_GLOBAL_LOCATION_MODELS.has(vertexModel)) {
    return chatWithGeminiGlobal(provider, vertexModel, messages, options);
  }

  const vertexAI = buildVertexAIForModel(provider, vertexModel);

  const generativeModel = vertexAI.getGenerativeModel({
    model: vertexModel,
    generationConfig: {
      temperature: options?.temperature,
      maxOutputTokens: options?.maxOutputTokens,
    },
  });

  function msgToParts(msg: ChatMessage) {
    if (typeof msg.content === "string") return [{ text: msg.content }];
    return msg.content.map((p) =>
      p.type === "text"
        ? { text: p.text }
        : { inlineData: { mimeType: p.mimeType, data: p.base64 } },
    );
  }

  const history = messages.slice(0, -1).map((m) => ({
    role: m.role,
    parts: msgToParts(m),
  }));

  const lastMessage = messages[messages.length - 1];
  if (!lastMessage) throw new Error("No messages provided");

  const chat = generativeModel.startChat({ history });
  const result = await chat.sendMessage(msgToParts(lastMessage));
  const response = result.response;
  const content = response.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  const usage = response.usageMetadata;

  return {
    content,
    inputTokens: usage?.promptTokenCount ?? 0,
    outputTokens: usage?.candidatesTokenCount ?? 0,
  };
}

export async function* streamChatWithGemini(
  model: string,
  messages: ChatMessage[],
  options?: { temperature?: number; maxOutputTokens?: number; signal?: AbortSignal },
): AsyncGenerator<{ type: "delta"; text: string } | { type: "done"; inputTokens: number; outputTokens: number }> {
  const provider = await getActiveProvider();
  const vertexModel = resolveVertexModelId(model);

  if (GEMINI_GLOBAL_LOCATION_MODELS.has(vertexModel)) {
    yield* streamChatWithGeminiGlobal(provider, vertexModel, messages, options);
    return;
  }

  const vertexAI = buildVertexAIForModel(provider, vertexModel);

  const generativeModel = vertexAI.getGenerativeModel({
    model: vertexModel,
    generationConfig: {
      temperature: options?.temperature,
      maxOutputTokens: options?.maxOutputTokens,
    },
  });

  function msgToParts(msg: ChatMessage) {
    if (typeof msg.content === "string") return [{ text: msg.content }];
    return msg.content.map((p) =>
      p.type === "text"
        ? { text: p.text }
        : { inlineData: { mimeType: p.mimeType, data: p.base64 } },
    );
  }

  const history = messages.slice(0, -1).map((m) => ({
    role: m.role,
    parts: msgToParts(m),
  }));

  const lastMessage = messages[messages.length - 1];
  if (!lastMessage) throw new Error("No messages provided");

  const chat = generativeModel.startChat({ history });
  const streamResult = await chat.sendMessageStream(msgToParts(lastMessage));

  for await (const chunk of streamResult.stream) {
    if (options?.signal?.aborted) break;
    const text = chunk.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    if (text) yield { type: "delta", text };
  }

  const finalResponse = await streamResult.response;
  const usage = finalResponse.usageMetadata;
  yield {
    type: "done",
    inputTokens: usage?.promptTokenCount ?? 0,
    outputTokens: usage?.candidatesTokenCount ?? 0,
  };
}
