import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import request from "supertest";

beforeAll(() => {
  vi.stubEnv("JWT_SECRET", "test-jwt-secret-for-testing-only-32chars");
  vi.stubEnv("NODE_ENV", "test");
});

// Shared thenable chain result — controls what `await db.select().from().where()` resolves to
let chainResult: unknown[] = [];

const dbMock = {
  // Thenable — resolves when chain is awaited without a terminal
  then: (resolve: (v: unknown) => unknown) => Promise.resolve(chainResult).then(resolve),
  catch: (reject: (e: unknown) => unknown) => Promise.reject(new Error("chain error")).catch(reject),
  finally: (fn: () => void) => Promise.resolve(chainResult).finally(fn),

  select: vi.fn(),
  from: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  groupBy: vi.fn(),
  limit: vi.fn().mockResolvedValue([{ isActive: true }]),
  offset: vi.fn().mockResolvedValue([]),
  insert: vi.fn(),
  values: vi.fn(),
  update: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
  returning: vi.fn().mockResolvedValue([]),
  execute: vi.fn().mockResolvedValue([]),
  transaction: vi.fn().mockResolvedValue(undefined),
};

vi.mock("@workspace/db", () => ({
  db: dbMock,
  apiKeysTable: { id: "id", userId: "user_id" },
  usageLogsTable: {
    apiKeyId: "api_key_id", model: "model", createdAt: "created_at",
    totalTokens: "total_tokens", costUsd: "cost_usd", status: "status",
  },
  usersTable: { id: "id", isActive: "is_active" },
  webhooksTable: {},
  rateLimitBucketsTable: {},
  modelCostsTable: {},
  ipRateLimitsTable: {},
  auditLogsTable: {},
  violationLogsTable: {},
  plansTable: {},
  providersTable: {},
  promoCodesTable: {},
}));

beforeEach(() => {
  vi.resetAllMocks();
  chainResult = [];

  // Restore chain methods to return `this` for chaining
  dbMock.select.mockReturnValue(dbMock);
  dbMock.from.mockReturnValue(dbMock);
  dbMock.where.mockReturnValue(dbMock);
  dbMock.orderBy.mockReturnValue(dbMock);
  dbMock.groupBy.mockReturnValue(dbMock);
  dbMock.offset.mockResolvedValue([]);
  dbMock.insert.mockReturnValue(dbMock);
  dbMock.values.mockReturnValue(dbMock);
  dbMock.update.mockReturnValue(dbMock);
  dbMock.set.mockReturnValue(dbMock);
  dbMock.delete.mockReturnValue(dbMock);
  dbMock.returning.mockResolvedValue([]);

  // requireAuth uses db.select().from().where().limit(1) to check if user is active
  dbMock.limit.mockResolvedValue([{ isActive: true }]);
});

async function makeUserToken() {
  const { signToken } = await import("../../lib/jwt");
  return signToken({ sub: "42", email: "user@test.com", role: "user", name: "User" });
}

describe("GET /portal/usage", () => {
  it("returns 401 without authentication", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app).get("/api/portal/usage");
    expect(res.status).toBe(401);
  });

  it("returns 400 for non-numeric days param", async () => {
    const token = await makeUserToken();
    const { default: app } = await import("../../app");
    const res = await request(app)
      .get("/api/portal/usage?days=not-a-number")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it("returns 200 with empty data for user with no API keys", async () => {
    const token = await makeUserToken();

    // requireAuth: first limit() call → user is active
    // usage route: db.select().from().where() is awaited directly → chainResult = []
    chainResult = [];

    const { default: app } = await import("../../app");
    const res = await request(app)
      .get("/api/portal/usage?days=7")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.recentLogs).toEqual([]);
    expect(res.body.dailyUsage).toEqual([]);
    expect(res.body.byModel).toEqual([]);
  });

  it("returns modelFilter as null when no model param provided", async () => {
    const token = await makeUserToken();
    chainResult = [];

    const { default: app } = await import("../../app");
    const res = await request(app)
      .get("/api/portal/usage?days=7")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.modelFilter).toBeNull();
  });

  it("returns modelFilter equal to given model param", async () => {
    const token = await makeUserToken();
    chainResult = [];

    const { default: app } = await import("../../app");
    const res = await request(app)
      .get("/api/portal/usage?model=gemini-2.5-flash")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.modelFilter).toBe("gemini-2.5-flash");
  });
});
