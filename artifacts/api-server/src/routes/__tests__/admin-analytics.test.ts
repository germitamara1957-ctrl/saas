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
  usersTable: { id: "id", email: "email", isActive: "is_active", creditBalance: "credit_balance" },
  apiKeysTable: { id: "id", userId: "user_id", isActive: "is_active" },
  usageLogsTable: {
    id: "id", apiKeyId: "api_key_id", model: "model",
    inputTokens: "input_tokens", outputTokens: "output_tokens",
    totalTokens: "total_tokens", costUsd: "cost_usd",
    status: "status", createdAt: "created_at",
  },
  rateLimitBucketsTable: {},
  webhooksTable: {},
  modelCostsTable: {},
  ipRateLimitsTable: {},
  auditLogsTable: {},
  violationLogsTable: {},
  plansTable: {},
  providersTable: {},
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

beforeEach(async () => {
  vi.resetAllMocks();
  dbMock.select.mockReturnThis();
  dbMock.from.mockReturnThis();
  dbMock.where.mockReturnThis();
  dbMock.limit.mockReturnThis();
  dbMock.orderBy.mockReturnThis();
  dbMock.offset.mockResolvedValue([]);
  dbMock.groupBy.mockReturnThis();
  dbMock.returning.mockResolvedValue([]);
  dbMock.then.mockImplementation((resolve: (v: unknown[]) => unknown) => resolve([]));

  const adminAuth = await import("../../middlewares/adminAuth");
  vi.mocked(adminAuth.requireAdmin).mockImplementation(async (req: any, _res: any, next: any) => {
    req.authUser = { sub: "1", email: "admin@test.com", role: "admin", name: "Admin" };
    next();
  });

  const rl = await import("../../middlewares/adminRateLimit");
  vi.mocked(rl.adminRateLimit).mockImplementation((_req: any, _res: any, next: any) => next());
});

describe("GET /admin/analytics/stats", () => {
  it("returns 200 with all stat fields", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app).get("/api/admin/analytics/stats");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("totalRequestsToday");
    expect(res.body).toHaveProperty("activeApiKeys");
    expect(res.body).toHaveProperty("activeUsers");
    expect(typeof res.body.totalRequestsToday).toBe("number");
  });

  it("returns 200 with topModelToday null when no data", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app).get("/api/admin/analytics/stats");
    expect(res.status).toBe(200);
    expect(res.body.topModelToday).toBeNull();
  });
});

describe("GET /admin/analytics/user-summary", () => {
  it("returns 400 when userId is missing", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app).get("/api/admin/analytics/user-summary");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/userId/i);
  });

  it("returns 400 when userId is not a number", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app).get("/api/admin/analytics/user-summary?userId=abc");
    expect(res.status).toBe(400);
  });

  it("returns 200 with zero stats when user has no keys", async () => {
    dbMock.then.mockImplementationOnce((resolve: (v: unknown[]) => unknown) => resolve([{ creditBalance: 50 }]));
    const { default: app } = await import("../../app");
    const res = await request(app).get("/api/admin/analytics/user-summary?userId=1");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("totalCalls");
    expect(res.body).toHaveProperty("activeKeyCount");
    expect(res.body.totalCalls).toBe(0);
  });
});

describe("GET /admin/analytics/timeseries", () => {
  it("returns 200 with timeseries structure", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app).get(
      "/api/admin/analytics/timeseries?from=2025-01-01&to=2025-01-31"
    );
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("daily");
    expect(res.body).toHaveProperty("byModel");
    expect(res.body).toHaveProperty("totals");
    expect(Array.isArray(res.body.daily)).toBe(true);
  });

  it("returns 200 with empty data when no records", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app).get("/api/admin/analytics/timeseries");
    expect(res.status).toBe(200);
    expect(res.body.daily).toEqual([]);
    expect(res.body.byModel).toEqual([]);
  });
});

describe("GET /admin/analytics/usage", () => {
  it("returns 200 with pagination structure", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app).get("/api/admin/analytics/usage");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("items");
    expect(res.body).toHaveProperty("total");
    expect(res.body).toHaveProperty("page");
  });

  it("returns 200 with items from DB", async () => {
    dbMock.offset.mockResolvedValueOnce([{
      id: 1, model: "gemini-2.5-flash", totalTokens: 100, costUsd: 0.001,
    }]);
    const { default: app } = await import("../../app");
    const res = await request(app).get("/api/admin/analytics/usage");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
  });
});
