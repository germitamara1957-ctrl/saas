import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import request from "supertest";

beforeAll(() => {
  vi.stubEnv("JWT_SECRET", "test-jwt-secret-for-testing-only-32chars");
  vi.stubEnv("NODE_ENV", "test");
});

const FAKE_HOOK = {
  id: 1,
  userId: 42,
  name: "My Hook",
  url: "https://example.com/hook",
  secret: "abc123",
  events: [],
  isActive: true,
  lastTriggeredAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const dbMock = {
  select: vi.fn(),
  from: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  offset: vi.fn(),
  insert: vi.fn(),
  values: vi.fn(),
  update: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
  returning: vi.fn(),
  execute: vi.fn(),
  transaction: vi.fn(),
  groupBy: vi.fn(),
};

vi.mock("@workspace/db", () => ({
  db: dbMock,
  webhooksTable: { id: "id", userId: "user_id", isActive: "is_active", createdAt: "created_at" },
  usersTable: { id: "id", isActive: "is_active" },
  apiKeysTable: {},
  usageLogsTable: {},
  rateLimitBucketsTable: {},
  modelCostsTable: {},
  ipRateLimitsTable: {},
  auditLogsTable: {},
  violationLogsTable: {},
  plansTable: {},
  providersTable: {},
  promoCodesTable: {},
}));

function restoreDbDefaults() {
  // All chain methods return dbMock for chaining
  dbMock.select.mockReturnValue(dbMock);
  dbMock.from.mockReturnValue(dbMock);
  dbMock.where.mockReturnValue(dbMock);
  dbMock.orderBy.mockResolvedValue([FAKE_HOOK]);
  dbMock.groupBy.mockReturnValue(dbMock);
  dbMock.insert.mockReturnValue(dbMock);
  dbMock.values.mockReturnValue(dbMock);
  dbMock.update.mockReturnValue(dbMock);
  dbMock.set.mockReturnValue(dbMock);
  dbMock.delete.mockReturnValue(dbMock);
  dbMock.execute.mockResolvedValue([]);
  dbMock.transaction.mockResolvedValue(undefined);
  // Terminal methods — set explicit defaults
  dbMock.limit.mockResolvedValue([{ isActive: true }]);
  dbMock.offset.mockResolvedValue([]);
  dbMock.returning.mockResolvedValue([FAKE_HOOK]);
}

beforeEach(() => {
  vi.resetAllMocks();
  restoreDbDefaults();
});

async function makeUserToken() {
  const { signToken } = await import("../../lib/jwt");
  return signToken({ sub: "42", email: "user@test.com", role: "user", name: "User" });
}

describe("Portal Webhooks — Authentication", () => {
  it("GET /portal/webhooks returns 401 without token", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app).get("/api/portal/webhooks");
    expect(res.status).toBe(401);
  });

  it("POST /portal/webhooks returns 401 without token", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app)
      .post("/api/portal/webhooks")
      .send({ name: "Test", url: "https://example.com/hook", events: [] });
    expect(res.status).toBe(401);
  });

  it("DELETE /portal/webhooks/:id returns 401 without token", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app).delete("/api/portal/webhooks/1");
    expect(res.status).toBe(401);
  });
});

describe("Portal Webhooks — Input Validation", () => {
  it("POST /portal/webhooks returns 400 for missing name", async () => {
    const token = await makeUserToken();
    const { default: app } = await import("../../app");
    const res = await request(app)
      .post("/api/portal/webhooks")
      .set("Authorization", `Bearer ${token}`)
      .send({ url: "https://example.com/hook" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name/i);
  });

  it("POST /portal/webhooks returns 400 for invalid URL", async () => {
    const token = await makeUserToken();
    const { default: app } = await import("../../app");
    const res = await request(app)
      .post("/api/portal/webhooks")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "My Hook", url: "not-a-url" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/url/i);
  });

  it("DELETE /portal/webhooks/:id returns 400 for non-numeric id", async () => {
    const token = await makeUserToken();
    const { default: app } = await import("../../app");
    const res = await request(app)
      .delete("/api/portal/webhooks/abc")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid id/i);
  });

  it("PUT /portal/webhooks/:id returns 400 for invalid URL in body", async () => {
    const token = await makeUserToken();
    const { default: app } = await import("../../app");
    const res = await request(app)
      .put("/api/portal/webhooks/1")
      .set("Authorization", `Bearer ${token}`)
      .send({ url: "not-valid" });
    expect(res.status).toBe(400);
  });
});

describe("Portal Webhooks — GET list", () => {
  it("returns 200 with an array of webhooks", async () => {
    const token = await makeUserToken();
    const { default: app } = await import("../../app");
    const res = await request(app)
      .get("/api/portal/webhooks")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe("Portal Webhooks — POST create", () => {
  it("returns 201 with created webhook", async () => {
    const token = await makeUserToken();
    // returning default is [FAKE_HOOK] — will be used by insert().values().returning()
    const { default: app } = await import("../../app");
    const res = await request(app)
      .post("/api/portal/webhooks")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "My Hook", url: "https://example.com/hook", events: ["usage.success"] });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe(FAKE_HOOK.id);
  });
});

describe("Portal Webhooks — Soft Limit (plan.maxWebhooks)", () => {
  it("returns 403 when user is at plan webhook limit", async () => {
    const token = await makeUserToken();
    // Sequence of terminal limit/where calls:
    //   1) requireAuth — users limit(1) → [{ isActive: true }]
    //   2) handler users limit(1)       → [{ planId: 7 }]
    //   3) handler plans limit(1)       → [{ maxWebhooks: 2, name: "Starter" }]
    //   4) handler webhooks where(...)  → 2 rows → at-limit
    dbMock.limit
      .mockResolvedValueOnce([{ isActive: true }])
      .mockResolvedValueOnce([{ planId: 7 }])
      .mockResolvedValueOnce([{ maxWebhooks: 2, name: "Starter" }]);
    dbMock.where
      .mockReturnValueOnce(dbMock) // requireAuth
      .mockReturnValueOnce(dbMock) // user select
      .mockReturnValueOnce(dbMock) // plan select
      .mockResolvedValueOnce([{ id: 1 }, { id: 2 }]); // existing webhooks count
    const { default: app } = await import("../../app");
    const res = await request(app)
      .post("/api/portal/webhooks")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Third Hook", url: "https://example.com/3", events: [] });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Starter/);
    expect(res.body.error).toMatch(/2/);
  });

  it("succeeds when user is below plan webhook limit", async () => {
    const token = await makeUserToken();
    dbMock.limit
      .mockResolvedValueOnce([{ isActive: true }])
      .mockResolvedValueOnce([{ planId: 7 }])
      .mockResolvedValueOnce([{ maxWebhooks: 5, name: "Pro" }]);
    dbMock.where
      .mockReturnValueOnce(dbMock)
      .mockReturnValueOnce(dbMock)
      .mockReturnValueOnce(dbMock)
      .mockResolvedValueOnce([{ id: 1 }]);
    const { default: app } = await import("../../app");
    const res = await request(app)
      .post("/api/portal/webhooks")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Second Hook", url: "https://example.com/2", events: [] });
    expect(res.status).toBe(201);
  });

  it("skips enforcement (allows create) when user has no plan assigned", async () => {
    const token = await makeUserToken();
    // 1) requireAuth users limit(1) → [{ isActive: true }]
    // 2) handler users limit(1)     → [{ planId: null }] → skip enforcement
    dbMock.limit
      .mockResolvedValueOnce([{ isActive: true }])
      .mockResolvedValueOnce([{ planId: null }]);
    const { default: app } = await import("../../app");
    const res = await request(app)
      .post("/api/portal/webhooks")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "No Plan Hook", url: "https://example.com/np", events: [] });
    expect(res.status).toBe(201);
  });
});

describe("Portal Webhooks — DELETE", () => {
  it("returns 200 when webhook is found and deleted", async () => {
    const token = await makeUserToken();
    // returning resolves to [FAKE_HOOK] by default — webhook found
    const { default: app } = await import("../../app");
    const res = await request(app)
      .delete("/api/portal/webhooks/1")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("returns 404 when webhook is not found", async () => {
    const token = await makeUserToken();
    // Override returning for this test: returning resolves to []
    dbMock.returning.mockResolvedValue([]);
    const { default: app } = await import("../../app");
    const res = await request(app)
      .delete("/api/portal/webhooks/999")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
