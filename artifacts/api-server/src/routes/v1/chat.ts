import { Router, type IRouter } from "express";
import { db, usageLogsTable } from "@workspace/db";
import { ChatCompletionBody } from "@workspace/api-zod";
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

async function handleChat(
  req: Parameters<Parameters<typeof router.post>[1]>[0],
  res: Parameters<Parameters<typeof router.post>[1]>[1],
  openaiCompat: boolean,
): Promise<void> {
  // Accept both our format and OpenAI format
  const body = req.body as Record<string, unknown>;
  const normalizedBody = {
    model: body.model,
    messages: body.messages,
    stream: body.stream ?? false,
    temperature: body.temperature,
    maxOutputTokens: (body.maxOutputTokens ?? body.max_tokens) as number | undefined,
  };

  const parsed = ChatCompletionBody.safeParse(normalizedBody);
  if (!parsed.success) {
    sendError(res, 400, parsed.error.message, openaiCompat);
    return;
  }

  const { model: rawModel, messages, temperature, maxOutputTokens, stream } = parsed.data;
  const model = rawModel.toLowerCase().trim();
  const apiKey = req.apiKey!;
  const requestId = req.preassignedRequestId ?? generateRequestId();
  const created = Math.floor(Date.now() / 1000);

  // imagen-* and veo-* are generation-only models; they cannot be used as chat models
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

  // If model is NOT in the user's plan, they can only use it via top-up credit.
  // Reject early if they have no top-up balance — saves an expensive call.
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

  // ── Layer 4 (pre-check): reject immediately if account is already suspended ──
  const suspended = await isGuardrailSuspended(apiKey.userId);
  if (suspended) {
    const errMsg =
      "Your account has been suspended due to repeated policy violations. Please contact support. " +
      "| حسابك موقوف بسبب انتهاك متكرر لسياسات الاستخدام. تواصل مع الدعم الفني.";
    sendError(res, 403, errMsg, openaiCompat, { type: "invalid_request_error", code: "account_suspended" });
    return;
  }

  const estimatedInputTokens = messages.reduce((acc, m) => {
    const rawContent = m.content as string | Array<{ type: string; text?: string }>;
    const text = typeof rawContent === "string"
      ? rawContent
      : rawContent.filter((p) => p.type === "text").map((p) => p.text ?? "").join(" ");
    return acc + Math.ceil(text.length / 4);
  }, 0);
  const estimatedOutputTokens = maxOutputTokens ?? 2000;
  const minEstimatedCost = calculateChatCost(planModel, estimatedInputTokens, estimatedOutputTokens);
  // If model is in plan: any combined balance can pay. Else: top-up only.
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

  const mappedMessages: ChatMessage[] = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    content: m.content,
  }));

  // ── Layer 3: Keyword content check ────────────────────────────────────────
  const contentCheck = checkContent(mappedMessages);
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

  // ── Multimodal model validation ───────────────────────────────────────────
  // Images in message content are only supported for Gemini models.
  // Reject early with a clear error instead of silently stripping images.
  if (provider === "openai-compat" || provider === "mistral-raw-predict") {
    const hasImages = guardedMessages.some((msg) =>
      Array.isArray(msg.content) &&
      msg.content.some((part) => part.type === "image"),
    );
    if (hasImages) {
      sendError(
        res, 400,
        `Model "${model}" does not support image inputs. Image content is only supported for Gemini models (gemini-*).`,
        openaiCompat,
        { code: "model_not_supported" },
      );
      return;
    }
  }

  const opts = {
    temperature: temperature ?? undefined,
    maxOutputTokens: maxOutputTokens ?? undefined,
  };

  if (stream) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    let inputTokens = 0;
    let outputTokens = 0;
    let streamError: string | null = null;
    let clientDisconnected = false;
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
        } else {
          // Final done event — flush any buffered text outside think blocks
          emitDelta(thinkFilter.flush());
          inputTokens = event.inputTokens;
          outputTokens = event.outputTokens;
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
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            usage: { prompt_tokens: inputTokens, completion_tokens: outputTokens, total_tokens: inputTokens + outputTokens },
          };
          res.write(`data: ${JSON.stringify(doneChunk)}\n\n`);
        } else {
          res.write(
            `data: ${JSON.stringify({ id: requestId, model, done: true, inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, costUsd })}\n\n`,
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

  if (openaiCompat) {
    res.json({
      id: requestId,
      object: "chat.completion",
      created,
      model,
      choices: [{
        index: 0,
        message: { role: "assistant", content: cleanContent },
        finish_reason: "stop",
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
      inputTokens: chatResult.inputTokens,
      outputTokens: chatResult.outputTokens,
      totalTokens: chatResult.inputTokens + chatResult.outputTokens,
      costUsd,
    });
  }
}

// Original endpoint (our format)
router.post("/v1/chat", requireApiKey, (req, res) => handleChat(req, res, false));

// OpenAI-compatible endpoint (used by n8n, LangChain, etc.)
router.post("/v1/chat/completions", requireApiKey, (req, res) => handleChat(req, res, true));

export default router;
