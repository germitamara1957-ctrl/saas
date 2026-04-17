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

const mockPortalUser = {
  id: 2,
  email: "dev@test.com",
  name: "Dev User",
  role: "developer",
  isActive: true,
  creditBalance: 50.0,
  emailVerified: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

vi.mock("@workspace/db", () => ({
  db: dbMock,
  usersTable: {
    id: "id", email: "email", name: "name", role: "role", isActive: "is_active",
    creditBalance: "credit_balance", emailVerified: "email_verified",
    createdAt: "created_at", updatedAt: "updated_at",
  },
  apiKeysTable: {
    id: "id", userId: "user_id", planId: "plan_id", isActive: "is_active",
    keyHash: "key_hash", keyPrefix: "key_prefix", name: "name",
    creditBalance: "credit_balance", lastUsedAt: "last_used_at",
    revokedAt: "revoked_at", createdAt: "created_at", updatedAt: "updated_at",
  },
  plansTable: {
    id: "id", name: "name", priceUsd: "price_usd", monthlyCredits: "monthly_credits",
    isActive: "is_active", modelsAllowed: "models_allowed", rpm: "rpm",
    maxApiKeys: "max_api_keys", description: "description",
    createdAt: "created_at", updatedAt: "updated_at",
  },
  usageLogsTable: {
    id: "id", apiKeyId: "api_key_id", totalTokens: "total_tokens",
    costUsd: "cost_usd", createdAt: "created_at",
  },
  promoCodesTable: {
    id: "id", code: "code", creditsAmount: "credits_amount",
    maxUses: "max_uses", usedCount: "used_count", expiresAt: "expires_at", isActive: "is_active",
  },
  promoCodeUsesTable: { id: "id", promoCodeId: "promo_code_id", userId: "user_id" },
  rateLimitBucketsTable: {},
  webhooksTable: {},
  modelCostsTable: {},
  ipRateLimitsTable: {},
  auditLogsTable: {},
  violationLogsTable: {},
  providersTable: {},
}));

vi.mock("../../middlewares/adminAuth", () => ({
  requireAdmin: vi.fn(async (req: any, _res: any, next: any) => {
    req.authUser = { sub: "1", email: "admin@test.com", role: "admin", name: "Admin" };
    next();
  }),
  requireAuth: vi.fn(async (req: any, _res: any, next: any) => {
    req.authUser = { sub: "2", email: "dev@test.com", role: "developer", name: "Dev" };
    req.user = { id: 2, email: "dev@test.com" };
    next();
  }),
}));

vi.mock("../../middlewares/adminRateLimit", () => ({
  adminRateLimit: vi.fn((_req: any, _res: any, next: any) => next()),
  adminAuthRateLimit: vi.fn((_req: any, _res: any, next: any) => next()),
  portalTwoFaRateLimit: vi.fn((_req: any, _res: any, next: any) => next()),
}));

vi.mock("../../lib/crypto", () => ({
  hashPassword: vi.fn().mockResolvedValue("hashed"),
  generateApiKey: vi.fn().mockReturnValue("gw_testkey"),
  encryptApiKey: vi.fn().mockReturnValue("encrypted"),
  comparePassword: vi.fn().mockResolvedValue(true),
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
  dbMock.offset.mockResolvedValue([]);
  dbMock.insert.mockReturnThis();
  dbMock.values.mockReturnThis();
  dbMock.update.mockReturnThis();
  dbMock.set.mockReturnThis();
  dbMock.returning.mockResolvedValue([]);
  dbMock.groupBy.mockReturnThis();
  dbMock.transaction.mockResolvedValue(undefined);
  dbMock.then.mockImplementation((resolve: (v: unknown[]) => unknown) => resolve([]));

  const adminAuth = await import("../../middlewares/adminAuth");
  vi.mocked(adminAuth.requireAuth).mockImplementation(async (req: any, _res: any, next: any) => {
    req.authUser = { sub: "2", email: "dev@test.com", role: "developer", name: "Dev" };
    req.user = { id: 2, email: "dev@test.com" };
    next();
  });

  const rl = await import("../../middlewares/adminRateLimit");
  vi.mocked(rl.adminRateLimit).mockImplementation((_req: any, _res: any, next: any) => next());

  const iprl = await import("../../lib/ipRateLimit");
  vi.mocked(iprl.checkRegistrationLimit).mockResolvedValue({ allowed: true, retryAfterMs: 0 });
  vi.mocked(iprl.checkLoginLimit).mockResolvedValue({ allowed: true, retryAfterMs: 0 });
});

describe("GET /portal/me", () => {
  it("returns 401 when user not found in DB", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app).get("/api/portal/me");
    expect(res.status).toBe(401);
  });

  it("returns 200 with user profile when user exists", async () => {
    dbMock.then
      .mockImplementationOnce((resolve: (v: unknown[]) => unknown) => resolve([mockPortalUser]))
      .mockImplementation((resolve: (v: unknown[]) => unknown) => resolve([]));
    const { default: app } = await import("../../app");
    const res = await request(app).get("/api/portal/me");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("user");
    expect(res.body).toHaveProperty("totalCreditsBalance");
    expect(res.body).toHaveProperty("totalRequestsThisMonth");
  });
});

describe("GET /portal/api-keys", () => {
  it("returns 200 with empty array when no keys", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app).get("/api/portal/api-keys");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("returns 400 for invalid name on POST", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app)
      .post("/api/portal/api-keys")
      .send({ name: "x".repeat(200) });
    expect(res.status).toBe(400);
  });
});

describe("GET /portal/plans", () => {
  it("returns 200 with plan list", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app).get("/api/portal/plans");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe("POST /portal/promo-codes/redeem", () => {
  it("returns 400 when code is missing", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app).post("/api/portal/promo-codes/redeem").send({});
    expect(res.status).toBe(400);
  });

  it("returns 404 when promo code does not exist", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app)
      .post("/api/portal/promo-codes/redeem")
      .send({ code: "DOESNOTEXIST" });
    expect(res.status).toBe(404);
  });

  it("returns 400 when code is exhausted", async () => {
    const mockCode = {
      id: 1, code: "EXPIRED", creditsAmount: 10,
      maxUses: 100, usedCount: 100, isActive: true, expiresAt: null,
    };
    dbMock.then
      .mockImplementationOnce((resolve: (v: unknown[]) => unknown) => resolve([mockCode]));
    const { default: app } = await import("../../app");
    const res = await request(app)
      .post("/api/portal/promo-codes/redeem")
      .send({ code: "EXPIRED" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("code_exhausted");
  });

  it("returns 400 when user already used the code", async () => {
    const mockCode = {
      id: 1, code: "SAVE10", creditsAmount: 10,
      maxUses: 100, usedCount: 5, isActive: true, expiresAt: null,
    };
    dbMock.then
      .mockImplementationOnce((resolve: (v: unknown[]) => unknown) => resolve([mockCode]))
      .mockImplementationOnce((resolve: (v: unknown[]) => unknown) => resolve([{ id: 99 }]));
    const { default: app } = await import("../../app");
    const res = await request(app)
      .post("/api/portal/promo-codes/redeem")
      .send({ code: "SAVE10" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("already_used");
  });
});
