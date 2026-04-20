import { Router, type IRouter } from "express";
import { z } from "zod";
import { db, usageLogsTable } from "@workspace/db";
import { requireApiKey } from "../../middlewares/apiKeyAuth";
import { checkRateLimit } from "../../lib/rateLimit";
import {
  detectModelProvider,
  normalizeToPlanModelId,
  chatWithGemini,
  chatWithOpenAICompat,
  chatWithMistralRawPredict,
  streamChatWithGemini,
  streamChatWithOpenAICompat,
  streamChatWithMistralRawPredict,
  type ChatMessage,
  type ChatOptions,
  type ToolCall,
} from "../../lib/vertexai";
import { calculateChatCost } from "../../lib/billing";
import { generateRequestId } from "../../lib/crypto";
import {
  checkContent,
  injectSafetyPrompt,
  isGuardrailSuspended,
  recordViolation,
} from "../../lib/guardrails";
import { stripThinkTags, ThinkTagFilter, deductAndLog, isModelInPlan } from "../../lib/chatUtils";
import { dispatchWebhooks } from "../../lib/webhookDispatcher";

const router: IRouter = Router();

// Local lenient body schema. Accepts plain text, OpenAI multimodal arrays,
// AND OpenAI tool-calling messages (assistant.tool_calls + role:"tool").
const ContentPartSchema = z.union([
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({
    type: z.string(), // "image", "audio", "video", "file", "document", ...
    mimeType: z.string(),
    base64: z.string(),
  }),
  // OpenAI multimodal image_url part — we accept and convert to our format.
  z.object({
    type: z.literal("image_url"),
    image_url: z.union([z.string(), z.object({ url: z.string() })]),
  }),
]);

const ToolCallSchema = z.object({
  id: z.string(),
  type: z.literal("function").default("function"),
  function: z.object({
    name: z.string(),
    arguments: z.string(),
  }),
});

const MessageSchema = z.object({
  role: z.string(),
  content: z.union([z.string(), z.array(ContentPartSchema).min(1), z.null()]).optional(),
  tool_calls: z.array(ToolCallSchema).optional(),
  tool_call_id: z.string().optional(),
  name: z.string().optional(),
});

const ToolDefinitionSchema = z.object({
  type: z.literal("function").default("function"),
  function: z.object({
    name: z.string(),
    description: z.string().optional(),
    parameters: z.record(z.unknown()).optional(),
  }),
});

const ToolChoiceSchema = z.union([
  z.literal("auto"),
  z.literal("none"),
  z.literal("required"),
  z.object({
    type: z.literal("function"),
    function: z.object({ name: z.string() }),
  }),
]);

const ChatBodySchema = z.object({
  model: z.string(),
  messages: z.array(MessageSchema).min(1),
  stream: z.boolean().default(false),
  temperature: z.number().optional(),
  maxOutputTokens: z.number().optional(),
  tools: z.array(ToolDefinitionSchema).optional(),
  tool_choice: ToolChoiceSchema.optional(),
  parallel_tool_calls: z.boolean().optional(),
});

/**
 * Returns an error response in the correct format:
 * - OpenAI format  { error: { message, type, param, code } }  when openaiCompat=true
 * - Our format     { error: "string" }                          otherwise
 */
function sendError(
  res: Parameters<Parameters<typeof router.post>[1]>[1],
  status: number,
  message: string,
  openaiCompat: boolean,
  opts?: { type?: string; code?: string; param?: string | null },
): void {
  if (openaiCompat) {
    res.status(status).json({
      error: {
        message,
        type: opts?.type ?? (status === 429 ? "requests" : status >= 500 ? "server_error" : "invalid_request_error"),
        param: opts?.param ?? null,
        code: opts?.code ?? null,
      },
    });
  } else {
    res.status(status).json({ error: message });
  }
}

/** Convert image_url parts to our internal format so providers see uniform shape. */
function normalizeContentPart(p: unknown): { type: string; text?: string; mimeType?: string; base64?: string } {
  const part = p as Record<string, unknown>;
  if (part.type === "image_url") {
    const imageUrl = part.image_url as string | { url: string };
    const url = typeof imageUrl === "string" ? imageUrl : imageUrl.url;
    // data:<mime>;base64,<data>
    const m = url.match(/^data:([^;]+);base64,(.+)$/);
    if (m) return { type: "image", mimeType: m[1]!, base64: m[2]! };
    // External URLs: pass as-is (Gemini path will reject; compat may accept).
    return { type: "image_url", text: url };
  }
  return part as { type: string; text?: string; mimeType?: string; base64?: string };
}

function normalizeMessage(m: z.infer<typeof MessageSchema>): ChatMessage {
  const role: ChatMessage["role"] =
    m.role === "assistant" || m.role === "model" ? "model" :
    m.role === "system" ? "system" :
    m.role === "tool" || m.role === "function" ? "tool" :
    "user";

  let content: ChatMessage["content"];
  if (m.content === null || m.content === undefined) {
    content = null;
  } else if (typeof m.content === "string") {
    content = m.content;
  } else {
    content = m.content.map(normalizeContentPart) as ChatMessage["content"];
  }

  const out: ChatMessage = { role, content };
  if (m.tool_calls && m.tool_calls.length) out.tool_calls = m.tool_calls;
  if (m.tool_call_id) out.tool_call_id = m.tool_call_id;
  if (m.name) out.name = m.name;
  return out;
}

async function handleChat(
  req: Parameters<Parameters<typeof router.post>[1]>[0],
  res: Parameters<Parameters<typeof router.post>[1]>[1],
  openaiCompat: boolean,
): Promise<void> {
  const body = req.body as Record<string, unknown>;
  const normalizedBody = {
    model: body.model,
    messages: body.messages,
    stream: body.stream ?? false,
    temperature: body.temperature,
    maxOutputTokens: (body.maxOutputTokens ?? body.max_tokens) as number | undefined,
    tools: body.tools,
    tool_choice: body.tool_choice,
    parallel_tool_calls: body.parallel_tool_calls,
  };

  const parsed = ChatBodySchema.safeParse(normalizedBody);
  if (!parsed.success) {
    sendError(res, 400, parsed.error.message, openaiCompat);
    return;
  }

  const {
    model: rawModel, messages, temperature, maxOutputTokens, stream,
    tools, tool_choice, parallel_tool_calls,
  } = parsed.data;
  const model = rawModel.toLowerCase().trim();
  const apiKey = req.apiKey!;
  const requestId = req.preassignedRequestId ?? generateRequestId();
  const created = Math.floor(Date.now() / 1000);

  if (model.startsWith("imagen-") || model.startsWith("veo-")) {
    sendError(
      res, 400,
      `Model "${model}" is an image/video generation model and cannot be used on this endpoint. ` +
        `Use POST /v1/generate for Imagen models or POST /v1/video for Veo models.`,
      openaiCompat,
      { code: "model_not_supported" },
    );
    return;
  }

  const allowed = apiKey.plan.modelsAllowed;
  const planModel = normalizeToPlanModelId(model);
  const modelInPlan = isModelInPlan(allowed, planModel);

  if (!modelInPlan && apiKey.topupCredit <= 0) {
    const errMsg =
      `Model "${model}" is not included in your current plan ("${apiKey.plan.name}"). ` +
      `You can either upgrade your plan or use top-up credit (currently $${apiKey.topupCredit.toFixed(4)}) to access this model. ` +
      `Models in your plan: ${allowed.join(", ")}`;
    await db.insert(usageLogsTable).values({
      apiKeyId: apiKey.id, model, inputTokens: 0, outputTokens: 0,
      totalTokens: 0, costUsd: 0, requestId, status: "rejected", errorMessage: errMsg,
    });
    sendError(res, 403, errMsg, openaiCompat, { type: "insufficient_quota", code: "model_not_available" });
    return;
  }

  const _rpm = apiKey.rpmLimit ?? apiKey.plan.rpm;
  const _bucket = apiKey.rpmLimit ? -apiKey.id : apiKey.userId;
  const withinLimit = await checkRateLimit(_bucket, _rpm, "chat");
  if (!withinLimit) {
    const errMsg = `Rate limit exceeded. Your plan allows ${apiKey.plan.rpm} requests per minute. Please wait before retrying.`;
    await db.insert(usageLogsTable).values({
      apiKeyId: apiKey.id, model, inputTokens: 0, outputTokens: 0,
      totalTokens: 0, costUsd: 0, requestId, status: "rejected", errorMessage: errMsg,
    });
    sendError(res, 429, errMsg, openaiCompat, { type: "requests", code: "rate_limit_exceeded" });
    return;
  }

  const suspended = await isGuardrailSuspended(apiKey.userId);
  if (suspended) {
    const errMsg =
      "Your account has been suspended due to repeated policy violations. Please contact support. " +
      "| حسابك موقوف بسبب انتهاك متكرر لسياسات الاستخدام. تواصل مع الدعم الفني.";
    sendError(res, 403, errMsg, openaiCompat, { type: "invalid_request_error", code: "account_suspended" });
    return;
  }

  const estimatedInputTokens = messages.reduce((acc, m) => {
    const rawContent = m.content;
    let text = "";
    if (typeof rawContent === "string") text = rawContent;
    else if (Array.isArray(rawContent)) {
      text = rawContent.map((p) => {
        const part = p as { type?: string; text?: string };
        return part.type === "text" ? (part.text ?? "") : "";
      }).join(" ");
    }
    return acc + Math.ceil(text.length / 4);
  }, 0);
  const estimatedOutputTokens = maxOutputTokens ?? 2000;
  const minEstimatedCost = calculateChatCost(planModel, estimatedInputTokens, estimatedOutputTokens);
  const availableForThisModel = modelInPlan ? apiKey.accountCreditBalance : apiKey.topupCredit;
  if (availableForThisModel < minEstimatedCost) {
    const errMsg = modelInPlan
      ? `Insufficient credits. Your balance ($${apiKey.accountCreditBalance.toFixed(6)}) is too low for model "${model}". Please top up your account or contact your platform admin.`
      : `Insufficient top-up credit. Model "${model}" is outside your plan and requires top-up balance (currently $${apiKey.topupCredit.toFixed(6)}). Either top up or upgrade your plan.`;
    await db.insert(usageLogsTable).values({
      apiKeyId: apiKey.id, model, inputTokens: 0, outputTokens: 0,
      totalTokens: 0, costUsd: 0, requestId, status: "rejected", errorMessage: errMsg,
    });
    sendError(res, 402, errMsg, openaiCompat, { type: "insufficient_quota", code: "insufficient_credits" });
    return;
  }

  const mappedMessages: ChatMessage[] = messages.map(normalizeMessage);

  // ── Layer 3: Keyword content check (text-only, skip tool/system messages) ──
  const contentCheck = checkContent(mappedMessages.filter((m) => m.role === "user" || m.role === "model"));
  if (contentCheck.blocked) {
    const violation = await recordViolation(apiKey.userId, contentCheck.category!, {
      apiKeyId: apiKey.id,
      requestId,
      model,
      messages: mappedMessages,
      ip: (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? req.socket?.remoteAddress,
    });
    await db.insert(usageLogsTable).values({
      apiKeyId: apiKey.id, model, inputTokens: 0, outputTokens: 0,
      totalTokens: 0, costUsd: 0, requestId, status: "rejected",
      errorMessage: `Guardrail blocked (${contentCheck.category}). Violation #${violation.warningNumber}`,
    });
    sendError(res, 400, violation.message, openaiCompat, { type: "invalid_request_error", code: "content_policy_violation" });
    return;
  }

  // ── Layer 2: Inject hidden safety system prompt ───────────────────────────
  const guardedMessages = injectSafetyPrompt(mappedMessages);

  const provider = detectModelProvider(model);

  // ── Multimodal model validation (audio/video/pdf only Gemini) ─────────────
  if (provider === "openai-compat" || provider === "mistral-raw-predict") {
    const hasNonImageBinary = guardedMessages.some((msg) =>
      Array.isArray(msg.content) &&
      msg.content.some(
        (part) => !("text" in part) && "mimeType" in part && !part.mimeType.startsWith("image/"),
      ),
    );
    if (hasNonImageBinary) {
      sendError(
        res, 400,
        `Model "${model}" only supports text and image inputs. Audio, video, and document (PDF) attachments are only supported by Gemini models (gemini-*). Either switch model or extract the text from your document client-side.`,
        openaiCompat,
        { code: "model_not_supported" },
      );
      return;
    }
  }

  const opts: ChatOptions = {
    temperature: temperature ?? undefined,
    maxOutputTokens: maxOutputTokens ?? undefined,
    tools: tools as ChatOptions["tools"],
    toolChoice: tool_choice,
    parallelToolCalls: parallel_tool_calls,
  };

  if (stream) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    let inputTokens = 0;
    let outputTokens = 0;
    let streamError: string | null = null;
    let clientDisconnected = false;
    let finalFinishReason: string = "stop";
    let finalToolCalls: ToolCall[] | undefined;
    const thinkFilter = new ThinkTagFilter();
    const abortController = new AbortController();

    res.on("close", () => {
      clientDisconnected = true;
      abortController.abort();
    });

    const emitDelta = (text: string) => {
      if (!text || clientDisconnected) return;
      if (openaiCompat) {
        const chunk = {
          id: requestId,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
        };
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      } else {
        res.write(`data: ${JSON.stringify({ id: requestId, model, delta: text })}\n\n`);
      }
    };

    const emitToolCallDelta = (
      idx: number, id: string | undefined, name: string | undefined, argsDelta: string | undefined,
    ) => {
      if (clientDisconnected) return;
      if (openaiCompat) {
        const tcChunk: Record<string, unknown> = { index: idx };
        if (id) tcChunk.id = id;
        tcChunk.type = "function";
        const fn: Record<string, string> = {};
        if (name) fn.name = name;
        if (argsDelta !== undefined) fn.arguments = argsDelta;
        if (Object.keys(fn).length) tcChunk.function = fn;
        const chunk = {
          id: requestId,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [{ index: 0, delta: { tool_calls: [tcChunk] }, finish_reason: null }],
        };
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      } else {
        res.write(`data: ${JSON.stringify({ id: requestId, model, tool_call_delta: { index: idx, id, name, argsDelta } })}\n\n`);
      }
    };

    const optsWithSignal = { ...opts, signal: abortController.signal };

    try {
      const generator =
        provider === "gemini"
          ? streamChatWithGemini(model, guardedMessages, optsWithSignal)
          : provider === "mistral-raw-predict"
            ? streamChatWithMistralRawPredict(model, guardedMessages, optsWithSignal)
            : streamChatWithOpenAICompat(model, guardedMessages, optsWithSignal);

      for await (const event of generator) {
        if (event.type === "delta") {
          emitDelta(thinkFilter.push(event.text));
        } else if (event.type === "tool_call_delta") {
          emitToolCallDelta(event.index, event.id, event.name, event.argumentsDelta);
        } else {
          // done
          emitDelta(thinkFilter.flush());
          inputTokens = event.inputTokens;
          outputTokens = event.outputTokens;
          finalFinishReason = event.finishReason;
          finalToolCalls = event.toolCalls;
        }
      }
    } catch (err) {
      streamError = err instanceof Error ? err.message : "Unknown error";
    }

    const costUsd = calculateChatCost(model, inputTokens, outputTokens);

    if (streamError) {
      await db.insert(usageLogsTable).values({
        apiKeyId: apiKey.id, model, inputTokens, outputTokens,
        totalTokens: inputTokens + outputTokens,
        costUsd: costUsd > 0 ? costUsd : 0,
        requestId, status: "error", errorMessage: streamError,
      });
      if (costUsd > 0) {
        await deductAndLog(apiKey.billingTarget, apiKey.id, model, requestId, inputTokens, outputTokens, costUsd, { modelInPlan });
      }
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ error: `API error: ${streamError}` })}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
      }
      return;
    }

    const sufficient = await deductAndLog(
      apiKey.billingTarget, apiKey.id, model, requestId, inputTokens, outputTokens, costUsd, { modelInPlan },
    );

    if (sufficient) {
      void dispatchWebhooks(apiKey.userId, "usage.success", {
        model, requestId, inputTokens, outputTokens, costUsd,
      });
    }

    if (!res.writableEnded) {
      if (!sufficient) {
        res.write(`data: ${JSON.stringify({ error: "Insufficient credits to complete this request." })}\n\n`);
      } else if (!clientDisconnected) {
        if (openaiCompat) {
          const doneChunk = {
            id: requestId,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [{ index: 0, delta: {}, finish_reason: finalFinishReason }],
            usage: { prompt_tokens: inputTokens, completion_tokens: outputTokens, total_tokens: inputTokens + outputTokens },
          };
          res.write(`data: ${JSON.stringify(doneChunk)}\n\n`);
        } else {
          res.write(
            `data: ${JSON.stringify({
              id: requestId, model, done: true,
              inputTokens, outputTokens, totalTokens: inputTokens + outputTokens,
              costUsd, finishReason: finalFinishReason, toolCalls: finalToolCalls,
            })}\n\n`,
          );
        }
      }
      res.write("data: [DONE]\n\n");
      res.end();
    }
    return;
  }

  // Non-streaming
  let chatResult;
  try {
    chatResult =
      provider === "gemini"
        ? await chatWithGemini(model, guardedMessages, opts)
        : provider === "mistral-raw-predict"
          ? await chatWithMistralRawPredict(model, guardedMessages, opts)
          : await chatWithOpenAICompat(model, guardedMessages, opts);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    await db.insert(usageLogsTable).values({
      apiKeyId: apiKey.id, model, inputTokens: 0, outputTokens: 0,
      totalTokens: 0, costUsd: 0, requestId, status: "error", errorMessage,
    });
    sendError(res, 502, `API error: ${errorMessage}`, openaiCompat, { type: "server_error", code: "upstream_error" });
    return;
  }

  const costUsd = calculateChatCost(model, chatResult.inputTokens, chatResult.outputTokens);
  const sufficient = await deductAndLog(
    apiKey.billingTarget, apiKey.id, model, requestId,
    chatResult.inputTokens, chatResult.outputTokens, costUsd, { modelInPlan },
  );

  if (!sufficient) {
    sendError(
      res, 402,
      "Insufficient credits to complete this request. Please top up your account or contact your platform admin.",
      openaiCompat,
      { type: "insufficient_quota", code: "insufficient_credits" },
    );
    return;
  }

  void dispatchWebhooks(apiKey.userId, "usage.success", {
    model, requestId,
    inputTokens: chatResult.inputTokens,
    outputTokens: chatResult.outputTokens,
    costUsd,
  });

  const cleanContent = stripThinkTags(chatResult.content);
  const finishReason =
    chatResult.toolCalls && chatResult.toolCalls.length ? "tool_calls" : chatResult.finishReason;

  if (openaiCompat) {
    const message: Record<string, unknown> = { role: "assistant", content: cleanContent || null };
    if (chatResult.toolCalls && chatResult.toolCalls.length) {
      message.tool_calls = chatResult.toolCalls;
    }
    res.json({
      id: requestId,
      object: "chat.completion",
      created,
      model,
      choices: [{
        index: 0,
        message,
        finish_reason: finishReason,
      }],
      usage: {
        prompt_tokens: chatResult.inputTokens,
        completion_tokens: chatResult.outputTokens,
        total_tokens: chatResult.inputTokens + chatResult.outputTokens,
      },
    });
  } else {
    res.json({
      id: requestId,
      model,
      content: cleanContent,
      toolCalls: chatResult.toolCalls,
      finishReason,
      inputTokens: chatResult.inputTokens,
      outputTokens: chatResult.outputTokens,
      totalTokens: chatResult.inputTokens + chatResult.outputTokens,
      costUsd,
    });
  }
}

// Original endpoint (our format)
router.post("/v1/chat", requireApiKey, (req, res) => handleChat(req, res, false));

// OpenAI-compatible endpoint (used by n8n, LangChain, Make, etc.)
router.post("/v1/chat/completions", requireApiKey, (req, res) => handleChat(req, res, true));

export default router;
