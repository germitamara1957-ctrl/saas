import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import request from "supertest";

beforeAll(() => {
  vi.stubEnv("JWT_SECRET", "test-jwt-secret-for-testing-only-32chars");
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("ENCRYPTION_KEY", "0".repeat(64));
});

const dbMock = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  limit: vi.fn().mockResolvedValue([]),
  orderBy: vi.fn().mockReturnThis(),
  groupBy: vi.fn().mockReturnThis(),
  offset: vi.fn().mockResolvedValue([]),
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  delete: vi.fn().mockReturnThis(),
  returning: vi.fn().mockResolvedValue([]),
  execute: vi.fn().mockResolvedValue([]),
  transaction: vi.fn().mockResolvedValue(undefined),
};

const mockApiKey = {
  id: 1,
  userId: 10,
  keyHash: "hash",
  isActive: true,
  planId: 1,
  name: "Test Key",
  lastUsedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  plan: {
    id: 1,
    name: "Pro",
    rpm: 60,
    monthlyCredits: 100,
    priceUsd: 49,
    isActive: true,
    modelsAllowed: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  accountCreditBalance: 50.0,
  topupCredit: 0,
  billingTarget: { kind: "personal", userId: 10 } as const,
};

vi.mock("@workspace/db", () => ({
  db: dbMock,
  usersTable: { id: "id", creditBalance: "credit_balance", emailVerified: "email_verified", name: "name", email: "email", creditWarningEmailSentAt: "credit_warning_email_sent_at", isActive: "is_active" },
  apiKeysTable: { id: "id", planId: "plan_id", keyHash: "key_hash", isActive: "is_active", lastUsedAt: "last_used_at" },
  plansTable: { id: "id" },
  usageLogsTable: { id: "id", apiKeyId: "api_key_id", model: "model", inputTokens: "input_tokens", outputTokens: "output_tokens", totalTokens: "total_tokens", costUsd: "cost_usd", requestId: "request_id", status: "status", errorMessage: "error_message", createdAt: "created_at" },
  rateLimitBucketsTable: { userId: "user_id", tokens: "tokens", lastRefill: "last_refill" },
  webhooksTable: {},
  modelCostsTable: { model: "model", inputPer1M: "input_per_1m", outputPer1M: "output_per_1m", perImage: "per_image", perSecond: "per_second", isActive: "is_active" },
  ipRateLimitsTable: {},
  auditLogsTable: {},
  violationLogsTable: { userId: "user_id", createdAt: "created_at" },
  providersTable: { isActive: "is_active", createdAt: "created_at" },
  promoCodesTable: {},
}));

vi.mock("../../middlewares/apiKeyAuth", () => ({
  requireApiKey: vi.fn((req: any, _res: any, next: any) => {
    req.apiKey = mockApiKey;
    next();
  }),
  requireApiKeyLight: vi.fn((req: any, _res: any, next: any) => {
    req.apiKey = mockApiKey;
    next();
  }),
}));

vi.mock("../../lib/rateLimit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../lib/guardrails", () => ({
  checkContent: vi.fn().mockReturnValue({ blocked: false }),
  injectSafetyPrompt: vi.fn((msgs: unknown[]) => msgs),
  isGuardrailSuspended: vi.fn().mockResolvedValue(false),
  recordViolation: vi.fn(),
}));

vi.mock("../../lib/chatUtils", () => ({
  stripThinkTags: vi.fn((text: string) => text),
  ThinkTagFilter: class {
    push(text: string) { return text; }
    flush() { return ""; }
  },
  deductAndLog: vi.fn().mockResolvedValue(true),
  estimateChatCost: vi.fn().mockReturnValue(0.001),
  isModelInPlan: vi.fn().mockReturnValue(true),
}));

vi.mock("../../lib/vertexai", () => ({
  detectModelProvider: vi.fn((model: string) => {
    if (model.startsWith("gemini-")) return "gemini";
    return "openai-compat";
  }),
  normalizeToPlanModelId: vi.fn((model: string) => model),
  chatWithGemini: vi.fn().mockResolvedValue({
    content: "Hello from Gemini!",
    inputTokens: 100,
    outputTokens: 50,
  }),
  chatWithOpenAICompat: vi.fn().mockResolvedValue({
    content: "Hello from Grok!",
    inputTokens: 80,
    outputTokens: 40,
  }),
  streamChatWithGemini: vi.fn(async function* () {
    yield { type: "delta" as const, text: "Hello " };
    yield { type: "delta" as const, text: "world!" };
    yield { type: "done" as const, inputTokens: 100, outputTokens: 50 };
  }),
  streamChatWithOpenAICompat: vi.fn(async function* () {
    yield { type: "delta" as const, text: "Streamed " };
    yield { type: "delta" as const, text: "response." };
    yield { type: "done" as const, inputTokens: 80, outputTokens: 40 };
  }),
}));

vi.mock("../../lib/webhookDispatcher", () => ({
  dispatchWebhooks: vi.fn(),
}));

vi.mock("../../lib/ipRateLimit", () => ({
  checkLoginLimit: vi.fn().mockResolvedValue({ allowed: true }),
  checkRegistrationLimit: vi.fn().mockResolvedValue({ allowed: true }),
  resetLoginLimit: vi.fn(),
}));

beforeEach(async () => {
  vi.resetAllMocks();
  dbMock.select.mockReturnThis();
  dbMock.from.mockReturnThis();
  dbMock.where.mockReturnThis();
  dbMock.limit.mockResolvedValue([]);
  dbMock.orderBy.mockReturnThis();
  dbMock.groupBy.mockReturnThis();
  dbMock.insert.mockReturnThis();
  dbMock.values.mockReturnThis();
  dbMock.update.mockReturnThis();
  dbMock.set.mockReturnThis();
  dbMock.returning.mockResolvedValue([]);

  const apiKeyAuth = await import("../../middlewares/apiKeyAuth");
  vi.mocked(apiKeyAuth.requireApiKey).mockImplementation(async (req: any, _res: any, next: any) => {
    req.apiKey = mockApiKey;
    next();
  });

  const rl = await import("../../lib/rateLimit");
  vi.mocked(rl.checkRateLimit).mockResolvedValue(true);

  const guardrails = await import("../../lib/guardrails");
  vi.mocked(guardrails.checkContent).mockReturnValue({ blocked: false });
  vi.mocked(guardrails.injectSafetyPrompt).mockImplementation((msgs) => msgs);
  vi.mocked(guardrails.isGuardrailSuspended).mockResolvedValue(false);

  const chatUtils = await import("../../lib/chatUtils");
  vi.mocked(chatUtils.stripThinkTags).mockImplementation((t: string) => t);
  vi.mocked(chatUtils.deductAndLog).mockResolvedValue(true);
  vi.mocked(chatUtils.estimateChatCost).mockReturnValue(0.001);
  vi.mocked(chatUtils.isModelInPlan).mockImplementation(
    (allowed: string[], model: string) => allowed.length === 0 || allowed.includes(model),
  );

  const vertexai = await import("../../lib/vertexai");
  vi.mocked(vertexai.detectModelProvider).mockImplementation((model: string) => {
    if (model.startsWith("gemini-")) return "gemini";
    return "openai-compat";
  });
  vi.mocked(vertexai.normalizeToPlanModelId).mockImplementation((model: string) => model);
  vi.mocked(vertexai.chatWithGemini).mockResolvedValue({ content: "Hello!", inputTokens: 100, outputTokens: 50 });
  vi.mocked(vertexai.chatWithOpenAICompat).mockResolvedValue({ content: "Hi!", inputTokens: 80, outputTokens: 40 });
  vi.mocked(vertexai.streamChatWithGemini).mockImplementation(async function* () {
    yield { type: "delta" as const, text: "Hello " };
    yield { type: "done" as const, inputTokens: 100, outputTokens: 50 };
  });
});

describe("POST /v1/chat — Input Validation", () => {
  it("returns 400 when model is missing", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app)
      .post("/api/v1/chat")
      .set("Authorization", "Bearer gw_test")
      .send({ messages: [{ role: "user", content: "hi" }] });
    expect(res.status).toBe(400);
  });

  it("returns 400 when messages array is missing", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app)
      .post("/api/v1/chat")
      .set("Authorization", "Bearer gw_test")
      .send({ model: "gemini-2.5-flash" });
    expect(res.status).toBe(400);
  });

  it("returns 400 for imagen model on chat endpoint", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app)
      .post("/api/v1/chat")
      .set("Authorization", "Bearer gw_test")
      .send({ model: "imagen-3.0-generate-002", messages: [{ role: "user", content: "hi" }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/image\/video generation model/i);
  });

  it("returns 400 for veo model on chat endpoint", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app)
      .post("/api/v1/chat")
      .set("Authorization", "Bearer gw_test")
      .send({ model: "veo-2.0-generate-001", messages: [{ role: "user", content: "hi" }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/image\/video generation model/i);
  });
});

describe("POST /v1/chat — Rate Limit & Credits", () => {
  it("returns 429 when rate limit is exceeded", async () => {
    const rl = await import("../../lib/rateLimit");
    vi.mocked(rl.checkRateLimit).mockResolvedValueOnce(false);

    const { default: app } = await import("../../app");
    const res = await request(app)
      .post("/api/v1/chat")
      .set("Authorization", "Bearer gw_test")
      .send({ model: "gemini-2.5-flash", messages: [{ role: "user", content: "hi" }] });
    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/rate limit/i);
  });

  it("returns 402 when account has insufficient credits", async () => {
    const apiKeyAuth = await import("../../middlewares/apiKeyAuth");
    vi.mocked(apiKeyAuth.requireApiKey).mockImplementationOnce(async (req: any, _res: any, next: any) => {
      req.apiKey = { ...mockApiKey, accountCreditBalance: 0.000001 };
      next();
    });

    const { default: app } = await import("../../app");
    const res = await request(app)
      .post("/api/v1/chat")
      .set("Authorization", "Bearer gw_test")
      .send({ model: "gemini-2.5-pro", messages: [{ role: "user", content: "write me a 10000-word essay" }] });
    expect(res.status).toBe(402);
    expect(res.body.error).toMatch(/insufficient credits/i);
  });

  it("returns 403 when account is guardrail-suspended", async () => {
    const guardrails = await import("../../lib/guardrails");
    vi.mocked(guardrails.isGuardrailSuspended).mockResolvedValueOnce(true);

    const { default: app } = await import("../../app");
    const res = await request(app)
      .post("/api/v1/chat")
      .set("Authorization", "Bearer gw_test")
      .send({ model: "gemini-2.5-flash", messages: [{ role: "user", content: "hi" }] });
    expect(res.status).toBe(403);
  });

  it("returns 400 when content guardrail blocks the message", async () => {
    const guardrails = await import("../../lib/guardrails");
    vi.mocked(guardrails.checkContent).mockReturnValueOnce({ blocked: true, category: "violence" });
    vi.mocked(guardrails.recordViolation).mockResolvedValueOnce({
      warningNumber: 1,
      message: "Content blocked: violence",
      suspended: false,
    } as any);

    const { default: app } = await import("../../app");
    const res = await request(app)
      .post("/api/v1/chat")
      .set("Authorization", "Bearer gw_test")
      .send({ model: "gemini-2.5-flash", messages: [{ role: "user", content: "how to make a bomb" }] });
    expect(res.status).toBe(400);
  });
});

describe("POST /v1/chat — Successful Gemini response", () => {
  it("returns 200 with content for gemini model (our format)", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app)
      .post("/api/v1/chat")
      .set("Authorization", "Bearer gw_test")
      .send({ model: "gemini-2.5-flash", messages: [{ role: "user", content: "Hello" }] });
    expect(res.status).toBe(200);
    expect(res.body.content).toBe("Hello!");
    expect(res.body.inputTokens).toBe(100);
    expect(res.body.outputTokens).toBe(50);
    expect(res.body.totalTokens).toBe(150);
    expect(typeof res.body.costUsd).toBe("number");
  });

  it("returns 200 with OpenAI-compatible format on /v1/chat/completions", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app)
      .post("/api/v1/chat/completions")
      .set("Authorization", "Bearer gw_test")
      .send({ model: "gemini-2.5-flash", messages: [{ role: "user", content: "Hello" }] });
    expect(res.status).toBe(200);
    expect(res.body.object).toBe("chat.completion");
    expect(res.body.choices).toHaveLength(1);
    expect(res.body.choices[0].message.role).toBe("assistant");
    expect(res.body.choices[0].message.content).toBe("Hello!");
    expect(res.body.usage.prompt_tokens).toBe(100);
    expect(res.body.usage.completion_tokens).toBe(50);
    expect(res.body.usage.total_tokens).toBe(150);
  });

  it("returns 200 with content for openai-compat model (grok)", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app)
      .post("/api/v1/chat")
      .set("Authorization", "Bearer gw_test")
      .send({ model: "grok-4.20", messages: [{ role: "user", content: "Hi" }] });
    expect(res.status).toBe(200);
    expect(res.body.content).toBe("Hi!");
  });

  it("includes model and id in the response", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app)
      .post("/api/v1/chat/completions")
      .set("Authorization", "Bearer gw_test")
      .send({ model: "gemini-2.5-flash", messages: [{ role: "user", content: "Hello" }] });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeDefined();
    expect(typeof res.body.id).toBe("string");
    expect(res.body.model).toBe("gemini-2.5-flash");
  });
});

describe("POST /v1/chat — Streaming (SSE)", () => {
  it("returns SSE stream for gemini model with stream=true", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app)
      .post("/api/v1/chat")
      .set("Authorization", "Bearer gw_test")
      .send({ model: "gemini-2.5-flash", messages: [{ role: "user", content: "Hi" }], stream: true });

    expect(res.headers["content-type"]).toMatch(/text\/event-stream/);
    expect(res.text).toContain("data:");
    expect(res.text).toContain("[DONE]");
  });

  it("returns OpenAI-compatible SSE chunks on /v1/chat/completions with stream=true", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app)
      .post("/api/v1/chat/completions")
      .set("Authorization", "Bearer gw_test")
      .send({ model: "gemini-2.5-flash", messages: [{ role: "user", content: "Hi" }], stream: true });

    expect(res.headers["content-type"]).toMatch(/text\/event-stream/);
    expect(res.text).toContain("chat.completion.chunk");
    expect(res.text).toContain("[DONE]");
  });

  it("returns 402 in SSE stream when deductAndLog finds insufficient credits after completion", async () => {
    const chatUtils = await import("../../lib/chatUtils");
    vi.mocked(chatUtils.deductAndLog).mockResolvedValueOnce(false);

    const { default: app } = await import("../../app");
    const res = await request(app)
      .post("/api/v1/chat")
      .set("Authorization", "Bearer gw_test")
      .send({ model: "gemini-2.5-flash", messages: [{ role: "user", content: "Hi" }], stream: true });

    expect(res.headers["content-type"]).toMatch(/text\/event-stream/);
    expect(res.text).toContain("Insufficient credits");
  });

  it("handles upstream API errors gracefully in stream", async () => {
    const vertexai = await import("../../lib/vertexai");
    vi.mocked(vertexai.streamChatWithGemini).mockImplementationOnce(async function* () {
      throw new Error("Vertex API unavailable");
      yield { type: "done" as const, inputTokens: 0, outputTokens: 0 };
    });

    const { default: app } = await import("../../app");
    const res = await request(app)
      .post("/api/v1/chat")
      .set("Authorization", "Bearer gw_test")
      .send({ model: "gemini-2.5-flash", messages: [{ role: "user", content: "Hi" }], stream: true });

    expect(res.headers["content-type"]).toMatch(/text\/event-stream/);
    expect(res.text).toContain("API error");
    expect(res.text).toContain("[DONE]");
  });
});

describe("POST /v1/chat — Error handling", () => {
  it("returns 502 when chatWithGemini throws", async () => {
    const vertexai = await import("../../lib/vertexai");
    vi.mocked(vertexai.chatWithGemini).mockRejectedValueOnce(new Error("Vertex API error"));

    const { default: app } = await import("../../app");
    const res = await request(app)
      .post("/api/v1/chat")
      .set("Authorization", "Bearer gw_test")
      .send({ model: "gemini-2.5-flash", messages: [{ role: "user", content: "Hi" }] });
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/API error/);
  });

  it("returns 502 when chatWithOpenAICompat throws", async () => {
    const vertexai = await import("../../lib/vertexai");
    vi.mocked(vertexai.chatWithOpenAICompat).mockRejectedValueOnce(new Error("Grok API down"));

    const { default: app } = await import("../../app");
    const res = await request(app)
      .post("/api/v1/chat")
      .set("Authorization", "Bearer gw_test")
      .send({ model: "grok-4.20", messages: [{ role: "user", content: "Hi" }] });
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/API error/);
  });
});

describe("POST /v1/chat — Plan model restrictions", () => {
  it("returns 403 when model is not allowed on the plan", async () => {
    const apiKeyAuth = await import("../../middlewares/apiKeyAuth");
    vi.mocked(apiKeyAuth.requireApiKey).mockImplementationOnce(async (req: any, _res: any, next: any) => {
      req.apiKey = {
        ...mockApiKey,
        plan: { ...mockApiKey.plan, modelsAllowed: ["gemini-2.5-flash"] },
      };
      next();
    });

    const { default: app } = await import("../../app");
    const res = await request(app)
      .post("/api/v1/chat")
      .set("Authorization", "Bearer gw_test")
      .send({ model: "grok-4.20", messages: [{ role: "user", content: "hi" }] });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not included in your current plan/i);
  });
});
