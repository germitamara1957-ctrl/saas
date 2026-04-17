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
  limit: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  offset: vi.fn().mockResolvedValue([]),
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  delete: vi.fn().mockReturnThis(),
  returning: vi.fn().mockResolvedValue([]),
  execute: vi.fn().mockResolvedValue([]),
  transaction: vi.fn().mockResolvedValue(undefined),
  groupBy: vi.fn().mockReturnThis(),
  then: vi.fn((resolve: (v: unknown[]) => unknown) => resolve([])),
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
    id: 1, name: "Pro", rpm: 60, monthlyCredits: 100, priceUsd: 49,
    isActive: true, modelsAllowed: ["gemini-2.5-flash", "gemini-2.5-pro", "grok-3", "imagen-4-fast", "veo-2"],
    createdAt: new Date(), updatedAt: new Date(),
  },
  accountCreditBalance: 50.0,
  topupCredit: 0,
  billingTarget: { targetType: "user" as const, userId: 10, accountId: null },
};

vi.mock("@workspace/db", () => ({
  db: dbMock,
  usersTable: {
    id: "id", creditBalance: "credit_balance", emailVerified: "email_verified",
    name: "name", email: "email", isActive: "is_active",
    creditWarningEmailSentAt: "credit_warning_email_sent_at",
  },
  apiKeysTable: {
    id: "id", planId: "plan_id", keyHash: "key_hash", isActive: "is_active",
    lastUsedAt: "last_used_at",
  },
  plansTable: { id: "id" },
  usageLogsTable: {
    id: "id", apiKeyId: "api_key_id", model: "model",
    inputTokens: "input_tokens", outputTokens: "output_tokens",
    totalTokens: "total_tokens", costUsd: "cost_usd",
    requestId: "request_id", status: "status", errorMessage: "error_message",
    createdAt: "created_at",
  },
  rateLimitBucketsTable: { userId: "user_id", tokens: "tokens", lastRefill: "last_refill" },
  webhooksTable: {},
  modelCostsTable: {
    model: "model", inputPer1M: "input_per_1m", outputPer1M: "output_per_1m",
    perImage: "per_image", perSecond: "per_second", isActive: "is_active",
  },
  ipRateLimitsTable: {},
  auditLogsTable: {},
  violationLogsTable: { userId: "user_id", createdAt: "created_at" },
  providersTable: { isActive: "is_active", createdAt: "created_at" },
  promoCodesTable: {},
}));

vi.mock("../../middlewares/adminAuth", () => ({
  requireAdmin: vi.fn(async (req: any, _res: any, next: any) => {
    req.authUser = { sub: "1", email: "admin@test.com", role: "admin", name: "Admin" };
    next();
  }),
  requireAuth: vi.fn(async (req: any, _res: any, next: any) => {
    req.authUser = { sub: "2", email: "dev@test.com", role: "developer", name: "Dev" };
    next();
  }),
}));

vi.mock("../../middlewares/adminRateLimit", () => ({
  adminRateLimit: vi.fn((_req: any, _res: any, next: any) => next()),
  adminAuthRateLimit: vi.fn((_req: any, _res: any, next: any) => next()),
  portalTwoFaRateLimit: vi.fn((_req: any, _res: any, next: any) => next()),
}));

vi.mock("../../middlewares/apiKeyAuth", () => ({
  requireApiKey: vi.fn(async (req: any, _res: any, next: any) => {
    req.apiKey = mockApiKey;
    next();
  }),
  requireApiKeyLight: vi.fn((req, _res, next) => { req.apiKey = mockApiKey; next(); }),
}));

vi.mock("../../lib/rateLimit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue(true),
  clearBucket: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../lib/guardrails", () => ({
  checkContent: vi.fn().mockReturnValue({ blocked: false }),
  injectSafetyPrompt: vi.fn().mockImplementation((msgs: unknown) => msgs),
  isGuardrailSuspended: vi.fn().mockResolvedValue(false),
  recordViolation: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../lib/billing", () => ({
  getSupportedModels: vi.fn().mockReturnValue([
    "gemini-2.5-flash", "gemini-2.5-pro", "grok-3",
    "imagen-4-fast", "veo-2",
  ]),
  calculateChatCost: vi.fn().mockReturnValue(0.001),
  warmModelCostsCache: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../lib/vertexai", () => ({
  detectModelProvider: vi.fn((model: string) => {
    if (model.startsWith("gemini-")) return "gemini";
    return "openai-compat";
  }),
  normalizeToPlanModelId: vi.fn((model: string) => model),
  chatWithGemini: vi.fn().mockResolvedValue({ content: "Hello!", inputTokens: 100, outputTokens: 50 }),
  chatWithOpenAICompat: vi.fn().mockResolvedValue({ content: "Hi!", inputTokens: 80, outputTokens: 40 }),
  streamChatWithGemini: vi.fn(async function* () {
    yield { type: "delta" as const, text: "Hello " };
    yield { type: "done" as const, inputTokens: 100, outputTokens: 50 };
  }),
  streamChatWithOpenAICompat: vi.fn(async function* () {
    yield { type: "delta" as const, text: "Hello " };
    yield { type: "done" as const, inputTokens: 80, outputTokens: 40 };
  }),
}));

vi.mock("../../lib/chatUtils", () => ({
  stripThinkTags: vi.fn().mockImplementation((t: string) => t),
  deductAndLog: vi.fn().mockResolvedValue(true),
  estimateChatCost: vi.fn().mockReturnValue(0.001),
  isModelInPlan: vi.fn().mockReturnValue(true),
  ThinkTagFilter: class {
    push(s: string) { return s; }
    flush() { return ""; }
  },
}));

vi.mock("../../lib/webhookDispatcher", () => ({
  dispatchWebhooks: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../lib/ipRateLimit", () => ({
  checkLoginLimit: vi.fn().mockResolvedValue({ allowed: true, retryAfterMs: 0 }),
  checkRegistrationLimit: vi.fn().mockResolvedValue({ allowed: true, retryAfterMs: 0 }),
  resetLoginLimit: vi.fn(),
}));

beforeEach(async () => {
  vi.resetAllMocks();
  dbMock.select.mockReturnThis();
  dbMock.from.mockReturnThis();
  dbMock.where.mockReturnThis();
  dbMock.limit.mockReturnThis();
  dbMock.orderBy.mockReturnThis();
  dbMock.insert.mockReturnThis();
  dbMock.values.mockReturnThis();
  dbMock.update.mockReturnThis();
  dbMock.set.mockReturnThis();
  dbMock.delete.mockReturnThis();
  dbMock.returning.mockResolvedValue([]);
  dbMock.execute.mockResolvedValue([]);
  dbMock.groupBy.mockReturnThis();
  dbMock.then.mockImplementation((resolve: (v: unknown[]) => unknown) => resolve([]));

  const apiKeyAuth = await import("../../middlewares/apiKeyAuth");
  vi.mocked(apiKeyAuth.requireApiKey).mockImplementation(async (req: any, _res: any, next: any) => {
    req.apiKey = mockApiKey;
    next();
  });

  const rl = await import("../../lib/rateLimit");
  vi.mocked(rl.checkRateLimit).mockResolvedValue(true);

  const billing = await import("../../lib/billing");
  vi.mocked(billing.getSupportedModels).mockReturnValue([
    "gemini-2.5-flash", "gemini-2.5-pro", "grok-3", "imagen-4-fast", "veo-2",
  ]);

  const guardrails = await import("../../lib/guardrails");
  vi.mocked(guardrails.checkContent).mockReturnValue({ blocked: false });
  vi.mocked(guardrails.injectSafetyPrompt).mockImplementation((msgs) => msgs);
  vi.mocked(guardrails.isGuardrailSuspended).mockResolvedValue(false);

  const vertexai = await import("../../lib/vertexai");
  vi.mocked(vertexai.detectModelProvider).mockImplementation((model: string) => {
    if (model.startsWith("gemini-")) return "gemini";
    return "openai-compat";
  });
  vi.mocked(vertexai.normalizeToPlanModelId).mockImplementation((model: string) => model);
  vi.mocked(vertexai.chatWithGemini).mockResolvedValue({ content: "Hello!", inputTokens: 100, outputTokens: 50 });

  const chatUtils = await import("../../lib/chatUtils");
  vi.mocked(chatUtils.deductAndLog).mockResolvedValue(true);
  vi.mocked(chatUtils.isModelInPlan).mockReturnValue(true);
  vi.mocked(chatUtils.stripThinkTags).mockImplementation((t: string) => t);

  const billing2 = await import("../../lib/billing");
  vi.mocked(billing2.calculateChatCost).mockReturnValue(0.001);

  const iprl = await import("../../lib/ipRateLimit");
  vi.mocked(iprl.checkLoginLimit).mockResolvedValue({ allowed: true, retryAfterMs: 0 });
});

describe("GET /v1/models", () => {
  it("returns 200 without authentication", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app).get("/api/v1/models");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("object", "list");
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it("returns model objects with required fields", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app).get("/api/v1/models");
    expect(res.status).toBe(200);
    const models: { id: string; object: string; owned_by: string }[] = res.body.data;
    expect(models.length).toBeGreaterThan(0);
    for (const m of models) {
      expect(m).toHaveProperty("id");
      expect(m).toHaveProperty("object", "model");
      expect(m).toHaveProperty("owned_by");
    }
  });

  it("returns sorted model list", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app).get("/api/v1/models");
    const ids: string[] = res.body.data.map((m: { id: string }) => m.id);
    const sorted = [...ids].sort((a, b) => a.localeCompare(b));
    expect(ids).toEqual(sorted);
  });
});

describe("POST /v1/files — image upload", () => {
  it("returns 400 when no file is uploaded", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app).post("/api/v1/files");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/file/i);
  });

  it("returns 200 with base64 data when valid image uploaded", async () => {
    const { default: app } = await import("../../app");
    const fakeImage = Buffer.from("fake-png-data");
    const res = await request(app)
      .post("/api/v1/files")
      .attach("file", fakeImage, { filename: "test.png", contentType: "image/png" });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("object", "file");
    expect(res.body).toHaveProperty("base64");
    expect(res.body).toHaveProperty("mimeType", "image/png");
  });

  it("rejects unsupported file type with non-200 status", async () => {
    const { default: app } = await import("../../app");
    const fakePdf = Buffer.from("%PDF-1.4");
    const res = await request(app)
      .post("/api/v1/files")
      .attach("file", fakePdf, { filename: "test.pdf", contentType: "application/pdf" });
    expect(res.status).not.toBe(200);
  });

  it("returns 401 without API key", async () => {
    const apiKeyAuth = await import("../../middlewares/apiKeyAuth");
    vi.mocked(apiKeyAuth.requireApiKey).mockImplementationOnce(async (_req: any, res: any, _next: any) => {
      res.status(401).json({ error: "Unauthorized" });
    });
    const { default: app } = await import("../../app");
    const fakeImage = Buffer.from("fake-data");
    const res = await request(app)
      .post("/api/v1/files")
      .attach("file", fakeImage, { filename: "img.png", contentType: "image/png" });
    expect(res.status).toBe(401);
  });
});

describe("POST /v1/responses — Responses API", () => {
  it("returns 400 when model is missing", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app)
      .post("/api/v1/responses")
      .send({ input: "Hello" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/model/i);
  });

  it("returns 400 when input is missing", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app)
      .post("/api/v1/responses")
      .send({ model: "gemini-2.5-flash" });
    expect(res.status).toBe(400);
  });

  it("returns 200 with Responses API format for string input", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app)
      .post("/api/v1/responses")
      .send({ model: "gemini-2.5-flash", input: "Hello world" });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("object", "response");
    expect(Array.isArray(res.body.output)).toBe(true);
  });

  it("returns 200 with Responses API format for array input", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app)
      .post("/api/v1/responses")
      .send({
        model: "gemini-2.5-flash",
        input: [{ role: "user", content: "Hello" }],
      });
    expect(res.status).toBe(200);
    expect(res.body.output[0]).toHaveProperty("type", "message");
  });

  it("returns 401 without API key", async () => {
    const apiKeyAuth = await import("../../middlewares/apiKeyAuth");
    vi.mocked(apiKeyAuth.requireApiKey).mockImplementationOnce(async (_req: any, res: any, _next: any) => {
      res.status(401).json({ error: "Unauthorized" });
    });
    const { default: app } = await import("../../app");
    const res = await request(app)
      .post("/api/v1/responses")
      .send({ model: "gemini-2.5-flash", input: "test" });
    expect(res.status).toBe(401);
  });
});
