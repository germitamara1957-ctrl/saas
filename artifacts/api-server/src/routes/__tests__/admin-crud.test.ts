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

vi.mock("@workspace/db", () => ({
  db: dbMock,
  usersTable: { id: "id", email: "email", isActive: "is_active" },
  apiKeysTable: {
    id: "id", userId: "user_id", planId: "plan_id", isActive: "is_active",
    keyHash: "key_hash", keyPrefix: "key_prefix", name: "name",
    creditBalance: "credit_balance", lastUsedAt: "last_used_at",
    revokedAt: "revoked_at", createdAt: "created_at", updatedAt: "updated_at",
  },
  plansTable: {
    id: "id", name: "name", priceUsd: "price_usd", monthlyCredits: "monthly_credits",
    isActive: "is_active", rpm: "rpm", modelsAllowed: "models_allowed",
    maxApiKeys: "max_api_keys", maxWebhooks: "max_webhooks", description: "description",
    createdAt: "created_at", updatedAt: "updated_at",
  },
  modelCostsTable: {
    model: "model", inputPer1M: "input_per_1m", outputPer1M: "output_per_1m",
    perImage: "per_image", perSecond: "per_second", isActive: "is_active",
    createdAt: "created_at", updatedAt: "updated_at",
  },
  providersTable: {
    id: "id", name: "name", slug: "slug", isActive: "is_active",
    projectId: "project_id", location: "location",
    createdAt: "created_at", updatedAt: "updated_at",
  },
  promoCodesTable: {
    id: "id", code: "code", creditsAmount: "credits_amount", maxUses: "max_uses",
    usedCount: "used_count", expiresAt: "expires_at", isActive: "is_active",
    createdAt: "created_at",
  },
  auditLogsTable: {
    id: "id", action: "action", actorId: "actor_id", actorEmail: "actor_email",
    targetId: "target_id", targetEmail: "target_email", details: "details",
    ip: "ip", createdAt: "created_at",
  },
  usageLogsTable: {},
  rateLimitBucketsTable: {},
  webhooksTable: {},
  ipRateLimitsTable: {},
  violationLogsTable: {},
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

vi.mock("../../lib/billing", () => ({
  getSupportedModels: vi.fn().mockReturnValue(["gemini-2.5-flash"]),
  calculateChatCost: vi.fn().mockReturnValue(0.001),
  warmModelCostsCache: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../lib/crypto", () => ({
  hashPassword: vi.fn().mockResolvedValue("hashed"),
  generateApiKey: vi.fn().mockReturnValue("gw_testkey"),
  encryptApiKey: vi.fn().mockReturnValue("encrypted"),
  comparePassword: vi.fn().mockResolvedValue(true),
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
  dbMock.delete.mockReturnThis();
  dbMock.returning.mockResolvedValue([]);
  dbMock.groupBy.mockReturnThis();
  dbMock.then.mockImplementation((resolve: (v: unknown[]) => unknown) => resolve([]));

  const adminAuth = await import("../../middlewares/adminAuth");
  vi.mocked(adminAuth.requireAdmin).mockImplementation(async (req: any, _res: any, next: any) => {
    req.authUser = { sub: "1", email: "admin@test.com", role: "admin", name: "Admin" };
    next();
  });

  const rl = await import("../../middlewares/adminRateLimit");
  vi.mocked(rl.adminRateLimit).mockImplementation((_req: any, _res: any, next: any) => next());
  vi.mocked(rl.adminAuthRateLimit).mockImplementation((_req: any, _res: any, next: any) => next());
});

describe("Plans CRUD", () => {
  it("GET /admin/plans returns 200 with array", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app).get("/api/admin/plans");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("POST /admin/plans returns 400 for missing fields", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app).post("/api/admin/plans").send({ name: "Test" });
    expect(res.status).toBe(400);
  });

  it("POST /admin/plans returns 201 for valid plan", async () => {
    dbMock.returning.mockResolvedValueOnce([{
      id: 1, name: "Starter", priceUsd: 0, monthlyCredits: 10, rpm: 60,
      maxApiKeys: 3, modelsAllowed: [], isActive: true,
      createdAt: new Date(), updatedAt: new Date(),
    }]);
    const { default: app } = await import("../../app");
    const res = await request(app).post("/api/admin/plans").send({
      name: "Starter", priceUsd: 0, monthlyCredits: 10, rpm: 60,
      maxApiKeys: 3, modelsAllowed: [],
    });
    expect(res.status).toBe(201);
  });

  it("DELETE /admin/plans/:id returns 404 when not found", async () => {
    dbMock.returning.mockResolvedValueOnce([]);
    const { default: app } = await import("../../app");
    const res = await request(app).delete("/api/admin/plans/9999");
    expect(res.status).toBe(404);
  });

  it("DELETE /admin/plans/:id returns 204 when deleted", async () => {
    dbMock.returning.mockResolvedValueOnce([{ id: 1 }]);
    const { default: app } = await import("../../app");
    const res = await request(app).delete("/api/admin/plans/1");
    expect(res.status).toBe(204);
  });
});

describe("Model Costs CRUD", () => {
  it("GET /admin/model-costs returns 200", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app).get("/api/admin/model-costs");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("POST /admin/model-costs returns 400 for missing model", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app).post("/api/admin/model-costs").send({ inputPer1M: 0.5 });
    expect(res.status).toBe(400);
  });

  it("POST /admin/model-costs returns 201 for valid body", async () => {
    dbMock.returning.mockResolvedValueOnce([{
      model: "gemini-test", inputPer1M: 0.5, outputPer1M: 1.5, isActive: true,
    }]);
    const { default: app } = await import("../../app");
    const res = await request(app).post("/api/admin/model-costs").send({
      model: "gemini-test", inputPer1M: 0.5, outputPer1M: 1.5,
    });
    expect(res.status).toBe(201);
  });
});

describe("API Keys CRUD (admin)", () => {
  it("GET /admin/api-keys returns 200", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app).get("/api/admin/api-keys");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("items");
  });

  it("GET /admin/api-keys supports userId filter", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app).get("/api/admin/api-keys?userId=1");
    expect(res.status).toBe(200);
  });

  it("POST /admin/api-keys returns 400 for missing userId", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app).post("/api/admin/api-keys").send({ name: "Key" });
    expect(res.status).toBe(400);
  });
});

describe("Providers CRUD", () => {
  it("GET /admin/providers returns 200", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app).get("/api/admin/providers");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("POST /admin/providers returns 400 for missing fields", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app).post("/api/admin/providers").send({ name: "Test" });
    expect(res.status).toBe(400);
  });
});

describe("Promo Codes CRUD (admin)", () => {
  it("GET /admin/promo-codes returns 200", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app).get("/api/admin/promo-codes");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("POST /admin/promo-codes returns 400 for missing code", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app).post("/api/admin/promo-codes").send({ creditsAmount: 10 });
    expect(res.status).toBe(400);
  });

  it("POST /admin/promo-codes returns 201 for valid body", async () => {
    dbMock.returning.mockResolvedValueOnce([{
      id: 1, code: "SAVE10", creditsAmount: 10, maxUses: 100,
      usedCount: 0, isActive: true, createdAt: new Date(),
    }]);
    const { default: app } = await import("../../app");
    const res = await request(app).post("/api/admin/promo-codes").send({
      code: "SAVE10", creditsAmount: 10, maxUses: 100,
    });
    expect(res.status).toBe(201);
  });
});

describe("Audit Log", () => {
  it("GET /admin/audit-log returns 200", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app).get("/api/admin/audit-log");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("items");
  });

  it("GET /admin/audit-log supports pagination", async () => {
    dbMock.offset.mockResolvedValueOnce([{
      id: 1, action: "user.login", actorId: 1, actorEmail: "admin@test.com",
      createdAt: new Date(),
    }]);
    const { default: app } = await import("../../app");
    const res = await request(app).get("/api/admin/audit-log?page=1&limit=10");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
  });
});
