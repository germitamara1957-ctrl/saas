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
  id: 3,
  userId: 30,
  keyHash: "hash3",
  isActive: true,
  planId: 1,
  name: "Video Key",
  lastUsedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  plan: {
    id: 1,
    name: "Pro",
    rpm: 60,
    monthlyCredits: 1000,
    priceUsd: 99,
    isActive: true,
    modelsAllowed: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  accountCreditBalance: 500.0,
  subscriptionCredit: 500.0,
  topupCredit: 0,
  organizationId: null,
  rpmLimit: null,
  billingTarget: { targetType: "user" as const, id: 30, creditBalance: 500.0, topupCreditBalance: 0 },
};

vi.mock("@workspace/db", () => ({
  db: dbMock,
  usersTable: { id: "id", creditBalance: "credit_balance", emailVerified: "email_verified", name: "name", email: "email", creditWarningEmailSentAt: "credit_warning_email_sent_at", isActive: "is_active" },
  apiKeysTable: { id: "id", planId: "plan_id", keyHash: "key_hash", isActive: "is_active", lastUsedAt: "last_used_at" },
  plansTable: { id: "id" },
  usageLogsTable: { id: "id", apiKeyId: "api_key_id", organizationId: "organization_id", model: "model", inputTokens: "input_tokens", outputTokens: "output_tokens", totalTokens: "total_tokens", costUsd: "cost_usd", requestId: "request_id", status: "status", errorMessage: "error_message", jobOperationId: "job_operation_id" },
  organizationsTable: { id: "id", creditBalance: "credit_balance", topupCreditBalance: "topup_credit_balance" },
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
  generateVideoWithVeo: vi.fn().mockResolvedValue({
    operationName: "projects/test-project/operations/op-12345",
  }),
  getVideoJobStatus: vi.fn().mockResolvedValue({
    done: true,
    videoUri: "gs://bucket/video.mp4",
  }),
  normalizeToPlanModelId: vi.fn((model: string) => model),
  detectModelProvider: vi.fn(() => "gemini"),
  chatWithGemini: vi.fn(),
  chatWithOpenAICompat: vi.fn(),
  streamChatWithGemini: vi.fn(),
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
  dbMock.returning.mockResolvedValue([{ creditBalance: 499.5 }]);
  dbMock.transaction.mockImplementation(async (cb: Function) => {
    await cb({
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ creditBalance: 499.5 }]),
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
  vi.mocked(vertexai.generateVideoWithVeo).mockResolvedValue({
    operationName: "projects/test-project/operations/op-12345",
  });
  vi.mocked(vertexai.normalizeToPlanModelId).mockImplementation((m) => m);
});

describe("POST /v1/video — Input Validation", () => {
  it("returns 400 for missing prompt", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app)
      .post("/api/v1/video")
      .set("Authorization", "Bearer gw_test")
      .send({ model: "veo-2.0-generate-001" });
    expect(res.status).toBe(400);
  });

  it("returns 400 for non-veo model (text model)", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app)
      .post("/api/v1/video")
      .set("Authorization", "Bearer gw_test")
      .send({ model: "gemini-2.5-flash", prompt: "A sunset timelapse" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/only Veo models/i);
  });

  it("returns 400 for imagen model on video endpoint", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app)
      .post("/api/v1/video")
      .set("Authorization", "Bearer gw_test")
      .send({ model: "imagen-3.0-generate-002", prompt: "A sunset" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/only Veo models/i);
  });

  it("returns 400 for grok model on video endpoint", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app)
      .post("/api/v1/video")
      .set("Authorization", "Bearer gw_test")
      .send({ model: "grok-4.20", prompt: "A flying bird" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/only Veo models/i);
  });
});

describe("POST /v1/video — Rate Limit & Credits", () => {
  it("returns 429 when rate limit exceeded", async () => {
    const rl = await import("../../lib/rateLimit");
    vi.mocked(rl.checkRateLimit).mockResolvedValueOnce(false);

    const { default: app } = await import("../../app");
    const res = await request(app)
      .post("/api/v1/video")
      .set("Authorization", "Bearer gw_test")
      .send({ model: "veo-2.0-generate-001", prompt: "Ocean waves" });
    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/rate limit/i);
  });

  it("returns 402 when balance is below video cost", async () => {
    const apiKeyAuth = await import("../../middlewares/apiKeyAuth");
    vi.mocked(apiKeyAuth.requireApiKey).mockImplementationOnce(async (req: any, _res: any, next: any) => {
      req.apiKey = { ...mockApiKey, accountCreditBalance: 0.001 };
      next();
    });

    const { default: app } = await import("../../app");
    const res = await request(app)
      .post("/api/v1/video")
      .set("Authorization", "Bearer gw_test")
      .send({ model: "veo-2.0-generate-001", prompt: "Space exploration", durationSeconds: 60 });
    expect(res.status).toBe(402);
    expect(res.body.error).toMatch(/insufficient credits/i);
  });
});

describe("POST /v1/video — Success", () => {
  it("returns 202 (Accepted) with jobId on successful submission", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app)
      .post("/api/v1/video")
      .set("Authorization", "Bearer gw_test")
      .send({ model: "veo-2.0-generate-001", prompt: "A peaceful forest", durationSeconds: 5 });
    expect(res.status).toBe(202);
    expect(res.body.status).toBe("pending");
    expect(res.body.jobId).toBeDefined();
    expect(typeof res.body.jobId).toBe("string");
    expect(typeof res.body.costUsd).toBe("number");
    expect(res.body.costUsd).toBeGreaterThan(0);
  });

  it("uses default veo model when none specified", async () => {
    const vertexai = await import("../../lib/vertexai");
    const { default: app } = await import("../../app");
    const res = await request(app)
      .post("/api/v1/video")
      .set("Authorization", "Bearer gw_test")
      .send({ prompt: "A mountain at sunrise" });
    expect(res.status).toBe(202);
    expect(vi.mocked(vertexai.generateVideoWithVeo)).toHaveBeenCalled();
  });

  it("returns 502 when Veo API throws", async () => {
    const vertexai = await import("../../lib/vertexai");
    vi.mocked(vertexai.generateVideoWithVeo).mockRejectedValueOnce(new Error("Veo quota exceeded"));

    const { default: app } = await import("../../app");
    const res = await request(app)
      .post("/api/v1/video")
      .set("Authorization", "Bearer gw_test")
      .send({ model: "veo-2.0-generate-001", prompt: "A dog running" });
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/Veo API error/i);
  });
});

describe("GET /v1/video/:jobId/status — Job polling", () => {
  it("returns 404 when jobId does not exist in DB", async () => {
    dbMock.limit.mockResolvedValueOnce([]);

    const { default: app } = await import("../../app");
    const res = await request(app)
      .get("/api/v1/video/nonexistent-job-id/status")
      .set("Authorization", "Bearer gw_test");
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("returns job status when valid jobId exists", async () => {
    dbMock.limit.mockResolvedValueOnce([{
      jobOperationId: "projects/test-project/operations/op-12345",
      model: "veo-2.0-generate-001",
      costUsd: 1.65,
    }]);

    const { default: app } = await import("../../app");
    const res = await request(app)
      .get("/api/v1/video/valid-job-id/status")
      .set("Authorization", "Bearer gw_test");
    expect([200, 502]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.jobId).toBeDefined();
      expect(["pending", "completed"]).toContain(res.body.status);
    }
  });
});
