import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import request from "supertest";

beforeAll(() => {
  vi.stubEnv("JWT_SECRET", "test-jwt-secret-for-testing-only-32chars");
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("SCRYPT_N", "16384");
});

const dbMock = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  limit: vi.fn().mockResolvedValue([]),
  orderBy: vi.fn().mockResolvedValue([]),
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
};

vi.mock("@workspace/db", () => ({
  db: dbMock,
  usersTable: { id: "id", email: "email", passwordHash: "password_hash", role: "role", isActive: "is_active", name: "name" },
  apiKeysTable: {},
  usageLogsTable: {},
  rateLimitBucketsTable: {},
  webhooksTable: {},
  modelCostsTable: {},
  ipRateLimitsTable: { id: "id", key: "key", attempts: "attempts", lastAttemptAt: "last_attempt_at", blockedUntil: "blocked_until" },
  auditLogsTable: { action: "action", actorId: "actor_id", actorEmail: "actor_email", targetId: "target_id", targetEmail: "target_email", details: "details", ip: "ip" },
  violationLogsTable: {},
  plansTable: {},
  providersTable: {},
  promoCodesTable: {},
}));

vi.mock("../../lib/ipRateLimit", () => ({
  checkLoginLimit: vi.fn().mockResolvedValue({ allowed: true, retryAfterMs: 0 }),
  resetLoginLimit: vi.fn(),
}));

beforeEach(async () => {
  vi.resetAllMocks();
  dbMock.select.mockReturnThis();
  dbMock.from.mockReturnThis();
  dbMock.where.mockReturnThis();
  dbMock.limit.mockResolvedValue([]);
  dbMock.insert.mockReturnThis();
  dbMock.values.mockReturnThis();
  dbMock.returning.mockResolvedValue([]);
  const iprl = await import("../../lib/ipRateLimit");
  vi.mocked(iprl.checkLoginLimit).mockResolvedValue({ allowed: true, retryAfterMs: 0 });
});

describe("POST /admin/auth/login — Input Validation", () => {
  it("returns 400 for missing email", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app)
      .post("/api/admin/auth/login")
      .send({ password: "test" });
    expect(res.status).toBe(400);
  });

  it("returns 400 for missing password", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app)
      .post("/api/admin/auth/login")
      .send({ email: "admin@example.com" });
    expect(res.status).toBe(400);
  });

  it("returns 400 for empty body", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app)
      .post("/api/admin/auth/login")
      .send({});
    expect(res.status).toBe(400);
  });
});

describe("POST /admin/auth/login — Auth Scenarios", () => {
  it("returns 401 for non-existent user", async () => {
    const { checkLoginLimit } = await import("../../lib/ipRateLimit");
    vi.mocked(checkLoginLimit).mockResolvedValueOnce({ allowed: true, retryAfterMs: 0 });
    dbMock.limit.mockResolvedValueOnce([]);

    const { default: app } = await import("../../app");
    const res = await request(app)
      .post("/api/admin/auth/login")
      .send({ email: "nobody@example.com", password: "wrong" });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid credentials");
  });

  it("returns 429 when IP is rate limited", async () => {
    const { checkLoginLimit } = await import("../../lib/ipRateLimit");
    vi.mocked(checkLoginLimit).mockResolvedValueOnce({ allowed: false, retryAfterMs: 60000 });

    const { default: app } = await import("../../app");
    const res = await request(app)
      .post("/api/admin/auth/login")
      .send({ email: "admin@example.com", password: "password" });
    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/Too many login attempts/);
  });
});

describe("Admin Route Access Control", () => {
  it("returns 401 when no Authorization header is provided", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app).get("/api/admin/analytics/stats");
    expect(res.status).toBe(401);
  });

  it("returns 401 for malformed Bearer token", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app)
      .get("/api/admin/analytics/stats")
      .set("Authorization", "Bearer not.a.valid.jwt");
    expect(res.status).toBe(401);
  });

  it("returns 403 when JWT role is not admin", async () => {
    const { signToken } = await import("../../lib/jwt");
    const token = signToken({ sub: "1", email: "user@test.com", role: "user", name: "User" });
    const { default: app } = await import("../../app");
    const res = await request(app)
      .get("/api/admin/analytics/stats")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Admin access required/);
  });
});
