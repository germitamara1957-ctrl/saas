import { describe, it, expect, vi, beforeAll } from "vitest";
import request from "supertest";

beforeAll(() => {
  vi.stubEnv("JWT_SECRET", "test-jwt-secret-for-testing-only-32chars");
  vi.stubEnv("NODE_ENV", "test");
});

vi.mock("@workspace/db", () => ({
  db: {
    execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
    transaction: vi.fn().mockResolvedValue(undefined),
  },
  usersTable: {},
  apiKeysTable: {},
  usageLogsTable: {},
  rateLimitBucketsTable: {},
  webhooksTable: {},
  modelCostsTable: {},
  ipRateLimitsTable: {},
  auditLogsTable: {},
  violationLogsTable: {},
  plansTable: {},
  providersTable: {},
  promoCodesTable: {},
  healthSnapshotsTable: {},
}));

describe("GET /healthz", () => {
  it("returns 200 with status ok when DB is reachable", async () => {
    const { default: app } = await import("../../app");
    const res = await request(app).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.db.ok).toBe(true);
    expect(typeof res.body.db.latencyMs).toBe("number");
    expect(typeof res.body.uptimeSeconds).toBe("number");
    expect(typeof res.body.timestamp).toBe("string");
  });

  it("returns 503 with status degraded when DB is unreachable", async () => {
    const { db } = await import("@workspace/db");
    vi.mocked(db.execute).mockRejectedValueOnce(new Error("connection refused"));

    const { default: app } = await import("../../app");
    const res = await request(app).get("/healthz");
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("degraded");
    expect(res.body.db.ok).toBe(false);
  });
});
