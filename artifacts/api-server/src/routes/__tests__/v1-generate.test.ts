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
  id: 2,
  userId: 20,
  keyHash: "hash2",
  isActive: true,
  planId: 1,
  name: "Image Key",
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
  billingTarget: { targetType: "user", id: 20, creditBalance: 50, topupCreditBalance: 0 } as const,
};

vi.mock("@workspace/db", () => ({
  db: dbMock,
  usersTable: { id: "id", creditBalance: "credit_balance", emailVerified: "email_verified", name: "name", email: "email", creditWarningEmailSentAt: "credit_warning_email_sent_at", isActive: "is_active" },
  apiKeysTable: { id: "id", planId: "plan_id", keyHash: "key_hash", isActive: "is_active", lastUsedAt: "last_used_at" },
  plansTable: { id: "id" },
  usageLogsTable: { id: "id", apiKeyId: "api_key_id", model: "model", inputTokens: "input_tokens", outputTokens: "output_tokens", totalTokens: "total_tokens", costUsd: "cost_usd", requestId: "request_id", status: "status", errorMessage: "error_message" },
  rateLimitBucketsTable: { userId: "user_id", tokens: "tokens", lastRefill: "last_refill" },
  modelCostsTable: { model: "model", inputPer1M: "input_per_1m", outputPer1M: "output_per_1m", perImage: "per_image", perSecond: "per_second", isActive: "is_active" },
  ipRateLimitsTable: {},
  auditLogsTable: {},
  violationLogsTable: {},
  webhooksTable: {},
  providersTable: {},
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

vi.mock("../../lib/vertexai", () => ({
  generateImageWithImagen: vi.fn().mockResolvedValue({
    images: [{ base64: "iVBORw0KGgo=", mimeType: "image/png" }],
  }),
  normalizeToPlanModelId: vi.fn((model: string) => model),
  detectModelProvider: vi.fn(() => "gemini"),
  chatWithGemini: vi.fn(),
  chatWithOpenAICompat: vi.fn(),
  streamChatWithGemini: vi.fn(),
  streamChatWithOpenAICompat: vi.fn(),
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
  dbMock.returning.mockResolvedValue([{ creditBalance: 49.9 }]);
  dbMock.transaction.mockImplementation(async (cb: Function) => {
    await cb({
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ creditBalance: 49.9 }]),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockResolvedValue([]),
    });
  });

  const apiKeyAuth = await import("../../middlewares/apiKeyAuth");
  vi.mocked(apiKeyAuth.requireApiKey).mockImplementation(async (req: any, _res: any, next: any) => {
    req.apiKey = mockApiKey;
    next();
  });

  const rl = await import("../../lib/rateLimit");
  vi.mocked(rl.checkRateLimit).mockResolvedValue(true);

  const vertexai = await import("../../lib/vertexai");
  vi.mocked(vertexai.generateImageWithImagen).mockResolvedValue({
    images: [{ base64: "iVBORw0KGgo=", mimeType: "image/png" }],
  });
  vi.mocked(vertexai.normalizeToPlanModelId).mockImplementation((m) => m);
});

describe("POST /v1/generate — Input Validation", () => {
  it("returns 400 for missing prompt", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app)
      .post("/api/v1/generate")
      .set("Authorization", "Bearer gw_test")
      .send({ model: "imagen-3.0-generate-002" });
    expect(res.status).toBe(400);
  });

  it("returns 400 for non-imagen model (text model)", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app)
      .post("/api/v1/generate")
      .set("Authorization", "Bearer gw_test")
      .send({ model: "gemini-2.5-flash", prompt: "A cat" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Imagen models/i);
  });

  it("returns 400 for veo model on generate endpoint", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app)
      .post("/api/v1/generate")
      .set("Authorization", "Bearer gw_test")
      .send({ model: "veo-2.0-generate-001", prompt: "A sunset" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Imagen models/i);
  });

  it("returns 400 for grok model on generate endpoint", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app)
      .post("/api/v1/generate")
      .set("Authorization", "Bearer gw_test")
      .send({ model: "grok-4.20", prompt: "A forest" });
    expect(res.status).toBe(400);
  });
});

describe("POST /v1/generate — Rate Limit & Credits", () => {
  it("returns 429 when rate limit exceeded", async () => {
    const rl = await import("../../lib/rateLimit");
    vi.mocked(rl.checkRateLimit).mockResolvedValueOnce(false);

    const { default: app } = await import("../../app");
    const res = await request(app)
      .post("/api/v1/generate")
      .set("Authorization", "Bearer gw_test")
      .send({ model: "imagen-3.0-generate-002", prompt: "A dog" });
    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/rate limit/i);
  });

  it("returns 402 when balance is below image cost", async () => {
    const apiKeyAuth = await import("../../middlewares/apiKeyAuth");
    vi.mocked(apiKeyAuth.requireApiKey).mockImplementationOnce(async (req: any, _res: any, next: any) => {
      req.apiKey = { ...mockApiKey, accountCreditBalance: 0.0001 };
      next();
    });

    const { default: app } = await import("../../app");
    const res = await request(app)
      .post("/api/v1/generate")
      .set("Authorization", "Bearer gw_test")
      .send({ model: "imagen-3.0-generate-002", prompt: "A mountain", sampleCount: 4 });
    expect(res.status).toBe(402);
    expect(res.body.error).toMatch(/insufficient credits/i);
  });
});

describe("POST /v1/generate — Success", () => {
  it("returns 200 with base64 images on success", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app)
      .post("/api/v1/generate")
      .set("Authorization", "Bearer gw_test")
      .send({ model: "imagen-3.0-generate-002", prompt: "A cat sitting on a chair", sampleCount: 1 });
    expect(res.status).toBe(200);
    expect(res.body.images).toHaveLength(1);
    expect(res.body.images[0].base64).toBe("iVBORw0KGgo=");
    expect(res.body.images[0].mimeType).toBe("image/png");
    expect(typeof res.body.costUsd).toBe("number");
  });

  it("uses default imagen model when none specified", async () => {
    const vertexai = await import("../../lib/vertexai");

    const { default: app } = await import("../../app");
    const res = await request(app)
      .post("/api/v1/generate")
      .set("Authorization", "Bearer gw_test")
      .send({ prompt: "A scenic landscape" });
    expect(res.status).toBe(200);
    expect(vi.mocked(vertexai.generateImageWithImagen)).toHaveBeenCalled();
  });

  it("returns 502 when Imagen API throws", async () => {
    const vertexai = await import("../../lib/vertexai");
    vi.mocked(vertexai.generateImageWithImagen).mockRejectedValueOnce(new Error("Imagen quota exceeded"));

    const { default: app } = await import("../../app");
    const res = await request(app)
      .post("/api/v1/generate")
      .set("Authorization", "Bearer gw_test")
      .send({ model: "imagen-3.0-generate-002", prompt: "A dog" });
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/Imagen API error/i);
  });
});
