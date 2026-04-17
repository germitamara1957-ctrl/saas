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
  usersTable: {
    id: "id", email: "email", name: "name", role: "role", isActive: "is_active",
    emailVerified: "email_verified", creditBalance: "credit_balance",
    createdAt: "created_at", updatedAt: "updated_at", passwordHash: "password_hash",
  },
  apiKeysTable: { id: "id", userId: "user_id", planId: "plan_id", isActive: "is_active", creditBalance: "credit_balance" },
  plansTable: { id: "id", name: "name", priceUsd: "price_usd", monthlyCredits: "monthly_credits", isActive: "is_active" },
  usageLogsTable: {},
  rateLimitBucketsTable: {},
  webhooksTable: {},
  modelCostsTable: {},
  ipRateLimitsTable: {},
  auditLogsTable: {
    action: "action", actorId: "actor_id", actorEmail: "actor_email",
    targetId: "target_id", targetEmail: "target_email", details: "details", ip: "ip",
  },
  violationLogsTable: {},
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

vi.mock("../../lib/crypto", () => ({
  hashPassword: vi.fn().mockResolvedValue("hashed_password"),
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

  const crypto = await import("../../lib/crypto");
  vi.mocked(crypto.hashPassword).mockResolvedValue("hashed_password");
});

const mockUser = {
  id: 42,
  email: "user@test.com",
  name: "Test User",
  role: "developer",
  isActive: true,
  emailVerified: true,
  creditBalance: 25.0,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("GET /admin/users — list", () => {
  it("returns 200 with empty list when no users", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app).get("/api/admin/users");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("items");
    expect(res.body).toHaveProperty("total");
  });

  it("returns 200 with users when DB returns data", async () => {
    dbMock.offset.mockResolvedValueOnce([mockUser]);
    const { default: app } = await import("../../app");
    const res = await request(app).get("/api/admin/users");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  it("returns 400 for invalid page param", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app).get("/api/admin/users?page=bad");
    expect(res.status).toBe(400);
  });
});

describe("GET /admin/users/:id — single user", () => {
  it("returns 404 when user does not exist", async () => {
    dbMock.then.mockImplementationOnce((resolve: (v: unknown[]) => unknown) => resolve([]));
    const { default: app } = await import("../../app");
    const res = await request(app).get("/api/admin/users/99999");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("User not found");
  });

  it("returns 200 with user when found", async () => {
    dbMock.then.mockImplementationOnce((resolve: (v: unknown[]) => unknown) => resolve([mockUser]));
    const { default: app } = await import("../../app");
    const res = await request(app).get("/api/admin/users/42");
    expect(res.status).toBe(200);
    expect(res.body.email).toBe("user@test.com");
  });
});

describe("POST /admin/users — create user", () => {
  it("returns 400 for missing required fields", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app)
      .post("/api/admin/users")
      .send({ email: "new@test.com" });
    expect(res.status).toBe(400);
  });

  it("returns 409 when email already exists", async () => {
    dbMock.then.mockImplementationOnce((resolve: (v: unknown[]) => unknown) => resolve([{ id: 1 }]));
    const { default: app } = await import("../../app");
    const res = await request(app)
      .post("/api/admin/users")
      .send({ email: "dup@test.com", password: "Pass1234!", name: "Dup" });
    expect(res.status).toBe(409);
  });

  it("returns 201 when user is created successfully", async () => {
    dbMock.then.mockImplementationOnce((resolve: (v: unknown[]) => unknown) => resolve([]));
    dbMock.returning.mockResolvedValueOnce([{
      id: 99, email: "new@test.com", name: "New", role: "developer",
      isActive: true, createdAt: new Date(), updatedAt: new Date(),
    }]);
    const { default: app } = await import("../../app");
    const res = await request(app)
      .post("/api/admin/users")
      .send({ email: "new@test.com", password: "Pass1234!", name: "New", role: "developer" });
    expect(res.status).toBe(201);
    expect(res.body.email).toBe("new@test.com");
  });
});

describe("PATCH /admin/users/:id — update user", () => {
  it("returns 404 when user not found", async () => {
    dbMock.returning.mockResolvedValueOnce([]);
    const { default: app } = await import("../../app");
    const res = await request(app)
      .patch("/api/admin/users/99999")
      .send({ name: "Updated" });
    expect(res.status).toBe(404);
  });

  it("returns 200 when user is updated", async () => {
    dbMock.returning.mockResolvedValueOnce([{ ...mockUser, name: "Updated" }]);
    const { default: app } = await import("../../app");
    const res = await request(app)
      .patch("/api/admin/users/42")
      .send({ name: "Updated" });
    expect(res.status).toBe(200);
  });
});

describe("DELETE /admin/users/:id — delete user", () => {
  it("returns 404 when user not found", async () => {
    dbMock.returning.mockResolvedValueOnce([]);
    const { default: app } = await import("../../app");
    const res = await request(app).delete("/api/admin/users/99999");
    expect(res.status).toBe(404);
  });

  it("returns 204 when user is deleted", async () => {
    dbMock.returning.mockResolvedValueOnce([{ id: 42, email: "user@test.com" }]);
    const { default: app } = await import("../../app");
    const res = await request(app).delete("/api/admin/users/42");
    expect(res.status).toBe(204);
  });
});
