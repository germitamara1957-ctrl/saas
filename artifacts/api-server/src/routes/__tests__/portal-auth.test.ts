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
  usersTable: { id: "id", email: "email", passwordHash: "password_hash", role: "role", isActive: "is_active", name: "name", isEmailVerified: "is_email_verified" },
  apiKeysTable: {},
  usageLogsTable: {},
  rateLimitBucketsTable: {},
  webhooksTable: {},
  modelCostsTable: {},
  ipRateLimitsTable: { id: "id", key: "key", attempts: "attempts", lastAttemptAt: "last_attempt_at", blockedUntil: "blocked_until" },
  auditLogsTable: {},
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
  dbMock.insert.mockReturnThis();
  dbMock.values.mockReturnThis();
  dbMock.returning.mockResolvedValue([]);
  const iprl = await import("../../lib/ipRateLimit");
  vi.mocked(iprl.checkLoginLimit).mockResolvedValue({ allowed: true, retryAfterMs: 0 });
  vi.mocked(iprl.checkRegistrationLimit).mockResolvedValue({ allowed: true, retryAfterMs: 0 });
});

describe("POST /portal/auth/register — Validation", () => {
  it("returns 400 for missing email", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app)
      .post("/api/portal/auth/register")
      .send({ password: "test123456", name: "Test User" });
    expect(res.status).toBe(400);
  });

  it("returns 400 for missing password", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app)
      .post("/api/portal/auth/register")
      .send({ email: "user@example.com", name: "Test User" });
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid email format", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app)
      .post("/api/portal/auth/register")
      .send({ email: "not-an-email", password: "test123456", name: "Test User" });
    expect(res.status).toBe(400);
  });
});

describe("POST /portal/auth/login — Validation & Auth", () => {
  it("returns 400 for missing email", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app)
      .post("/api/portal/auth/login")
      .send({ password: "test" });
    expect(res.status).toBe(400);
  });

  it("returns 400 for missing password", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app)
      .post("/api/portal/auth/login")
      .send({ email: "user@example.com" });
    expect(res.status).toBe(400);
  });

  it("returns 401 for non-existent user", async () => {
    dbMock.limit.mockResolvedValueOnce([]);
    const { default: app } = await import("../../app");
    const res = await request(app)
      .post("/api/portal/auth/login")
      .send({ email: "nobody@example.com", password: "wrong" });
    expect(res.status).toBe(401);
  });
});

describe("Protected Portal Routes — Authorization", () => {
  it("GET /portal/me returns 401 without token", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app).get("/api/portal/me");
    expect(res.status).toBe(401);
  });

  it("GET /portal/api-keys returns 401 without token", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app).get("/api/portal/api-keys");
    expect(res.status).toBe(401);
  });

  it("GET /portal/usage returns 401 without token", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app).get("/api/portal/usage");
    expect(res.status).toBe(401);
  });

  it("GET /portal/webhooks returns 401 without token", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app).get("/api/portal/webhooks");
    expect(res.status).toBe(401);
  });

  it("returns 401 for malformed Bearer token", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app)
      .get("/api/portal/me")
      .set("Authorization", "Bearer invalid.jwt.token");
    expect(res.status).toBe(401);
  });

  it("returns 401 for disabled account", async () => {
    const { signToken } = await import("../../lib/jwt");
    const token = signToken({ sub: "99", email: "disabled@test.com", role: "user", name: "Disabled" });
    dbMock.limit.mockResolvedValueOnce([{ isActive: false }]);

    const { default: app } = await import("../../app");
    const res = await request(app)
      .get("/api/portal/me")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/disabled/i);
  });
});
