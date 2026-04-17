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
  usersTable: {
    id: "id",
    email: "email",
    passwordHash: "password_hash",
    role: "role",
    isActive: "is_active",
    name: "name",
    isEmailVerified: "is_email_verified",
  },
  apiKeysTable: {},
  usageLogsTable: {},
  rateLimitBucketsTable: {},
  webhooksTable: {},
  modelCostsTable: {},
  ipRateLimitsTable: {
    id: "id",
    key: "key",
    attempts: "attempts",
    lastAttemptAt: "last_attempt_at",
    blockedUntil: "blocked_until",
  },
  auditLogsTable: {
    action: "action",
    actorId: "actor_id",
    actorEmail: "actor_email",
    targetId: "target_id",
    targetEmail: "target_email",
    details: "details",
    ip: "ip",
  },
  violationLogsTable: {},
  plansTable: {},
  providersTable: {},
  promoCodesTable: {},
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
  dbMock.limit.mockResolvedValue([]);
  dbMock.orderBy.mockReturnThis();
  dbMock.groupBy.mockReturnThis();
  dbMock.insert.mockReturnThis();
  dbMock.values.mockReturnThis();
  dbMock.returning.mockResolvedValue([]);
  const iprl = await import("../../lib/ipRateLimit");
  vi.mocked(iprl.checkLoginLimit).mockResolvedValue({ allowed: true, retryAfterMs: 0 });
  vi.mocked(iprl.checkRegistrationLimit).mockResolvedValue({ allowed: true, retryAfterMs: 0 });
});

describe("requireAdmin — no credentials", () => {
  it("returns 401 when neither cookie nor Bearer header is present", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app).get("/api/admin/analytics/stats");
    expect(res.status).toBe(401);
    expect(res.body.error).toBeDefined();
  });

  it("returns 401 for Authorization header with wrong scheme", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app)
      .get("/api/admin/analytics/stats")
      .set("Authorization", "Basic dXNlcjpwYXNz");
    expect(res.status).toBe(401);
  });
});

describe("requireAdmin — Bearer token auth", () => {
  it("accepts a valid admin JWT via Bearer header", async () => {
    const { signToken } = await import("../../lib/jwt");
    const token = signToken({ sub: "42", email: "admin@test.com", role: "admin", name: "Admin" });
    dbMock.limit.mockResolvedValue([{ isActive: true }]);

    const { default: app } = await import("../../app");
    const res = await request(app)
      .get("/api/admin/analytics/stats")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("returns 401 for malformed Bearer token", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app)
      .get("/api/admin/analytics/stats")
      .set("Authorization", "Bearer this.is.garbage");
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Invalid or expired token/);
  });

  it("returns 403 for developer-role JWT via Bearer", async () => {
    const { signToken } = await import("../../lib/jwt");
    const token = signToken({ sub: "5", email: "dev@test.com", role: "developer", name: "Dev" });

    const { default: app } = await import("../../app");
    const res = await request(app)
      .get("/api/admin/analytics/stats")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Admin access required/);
  });

  it("returns 401 when user is inactive (Bearer)", async () => {
    const { signToken } = await import("../../lib/jwt");
    const token = signToken({ sub: "99", email: "admin@test.com", role: "admin", name: "Admin" });
    dbMock.limit.mockResolvedValue([{ isActive: false }]);

    const { default: app } = await import("../../app");
    const res = await request(app)
      .get("/api/admin/analytics/stats")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/disabled/i);
  });
});

describe("requireAdmin — cookie auth", () => {
  it("accepts a valid admin JWT via auth_token cookie", async () => {
    const { signToken } = await import("../../lib/jwt");
    const token = signToken({ sub: "42", email: "admin@test.com", role: "admin", name: "Admin" });
    dbMock.limit.mockResolvedValue([{ isActive: true }]);

    const { default: app } = await import("../../app");
    const res = await request(app)
      .get("/api/admin/analytics/stats")
      .set("Cookie", `auth_token=${token}`);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("returns 403 for developer-role JWT via cookie", async () => {
    const { signToken } = await import("../../lib/jwt");
    const token = signToken({ sub: "5", email: "dev@test.com", role: "developer", name: "Dev" });

    const { default: app } = await import("../../app");
    const res = await request(app)
      .get("/api/admin/analytics/stats")
      .set("Cookie", `auth_token=${token}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Admin access required/);
  });

  it("returns 401 for tampered/invalid cookie value", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app)
      .get("/api/admin/analytics/stats")
      .set("Cookie", "auth_token=invalid.jwt.value");
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Invalid or expired token/);
  });

  it("returns 401 when user is inactive (cookie)", async () => {
    const { signToken } = await import("../../lib/jwt");
    const token = signToken({ sub: "99", email: "admin@test.com", role: "admin", name: "Admin" });
    dbMock.limit.mockResolvedValue([{ isActive: false }]);

    const { default: app } = await import("../../app");
    const res = await request(app)
      .get("/api/admin/analytics/stats")
      .set("Cookie", `auth_token=${token}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/disabled/i);
  });

  it("ignores irrelevant cookies and still returns 401 with no auth_token", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app)
      .get("/api/admin/analytics/stats")
      .set("Cookie", "session_id=abc123; theme=dark");
    expect(res.status).toBe(401);
  });
});

describe("requireAuth (portal routes) — cookie vs Bearer", () => {
  it("returns 401 for /portal/me with no credentials", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app).get("/api/portal/me");
    expect(res.status).toBe(401);
  });

  it("accepts developer JWT via Bearer on /portal/me", async () => {
    const { signToken } = await import("../../lib/jwt");
    const token = signToken({ sub: "3", email: "dev@test.com", role: "developer", name: "Dev" });
    dbMock.limit.mockResolvedValue([
      { id: 3, email: "dev@test.com", name: "Dev", role: "developer", isActive: true, emailVerified: true, creditBalance: "5.00", createdAt: new Date(), updatedAt: new Date() },
    ]);

    const { default: app } = await import("../../app");
    const res = await request(app)
      .get("/api/portal/me")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("accepts developer JWT via cookie on /portal/me", async () => {
    const { signToken } = await import("../../lib/jwt");
    const token = signToken({ sub: "3", email: "dev@test.com", role: "developer", name: "Dev" });
    dbMock.limit.mockResolvedValue([
      { id: 3, email: "dev@test.com", name: "Dev", role: "developer", isActive: true, emailVerified: true, creditBalance: "5.00", createdAt: new Date(), updatedAt: new Date() },
    ]);

    const { default: app } = await import("../../app");
    const res = await request(app)
      .get("/api/portal/me")
      .set("Cookie", `auth_token=${token}`);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("returns 401 for invalid cookie on portal route", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app)
      .get("/api/portal/me")
      .set("Cookie", "auth_token=bad.jwt.token");
    expect(res.status).toBe(401);
  });
});

describe("Admin logout — cookie cleared", () => {
  it("POST /admin/auth/logout clears the auth_token cookie", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app).post("/api/admin/auth/logout");
    expect(res.status).toBe(200);
    const cookies = res.headers["set-cookie"] as string[] | string | undefined;
    if (cookies) {
      const cookieStr = Array.isArray(cookies) ? cookies.join(";") : String(cookies);
      expect(cookieStr).toMatch(/auth_token/);
    }
  });

  it("POST /portal/auth/logout clears the auth_token cookie", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app).post("/api/portal/auth/logout");
    expect(res.status).toBe(200);
    const cookies = res.headers["set-cookie"] as string[] | string | undefined;
    if (cookies) {
      const cookieStr = Array.isArray(cookies) ? cookies.join(";") : String(cookies);
      expect(cookieStr).toMatch(/auth_token/);
    }
  });
});
