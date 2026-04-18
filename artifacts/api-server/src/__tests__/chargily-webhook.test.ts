/**
 * Chargily webhook handler tests — HMAC verification, replay protection,
 * CAS idempotency, and credit invariants. Uses real Postgres.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import crypto from "node:crypto";
import request from "supertest";
import { eq } from "drizzle-orm";
import {
  db, paymentIntentsTable, chargilyWebhookEventsTable, usersTable,
} from "@workspace/db";
import { hashPassword } from "../lib/crypto";

process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test_jwt_secret_xxxxxxxxxxxxxxxx";
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.CHARGILY_SECRET_KEY = "test_secret_xxx";
process.env.CHARGILY_WEBHOOK_SECRET = "whsec_test_for_webhook_tests";
process.env.CHARGILY_MODE = "test";

let app: import("express").Express;
let testUserId: number;

function sign(body: string): string {
  return crypto.createHmac("sha256", process.env.CHARGILY_WEBHOOK_SECRET!).update(body).digest("hex");
}

async function createTestUser(): Promise<number> {
  const email = `chargily-webhook-${Date.now()}-${Math.random()}@test.local`;
  const [u] = await db.insert(usersTable).values({
    email,
    passwordHash: await hashPassword("Password123!"),
    name: "Test",
    role: "developer",
    creditBalance: 0,
    topupCreditBalance: 0,
  }).returning();
  return u.id;
}

async function createPendingIntent(userId: number, checkoutId: string, amountUsd = 7.4074): Promise<number> {
  const [i] = await db.insert(paymentIntentsTable).values({
    userId,
    chargilyCheckoutId: checkoutId,
    amountDzd: 1000,
    amountUsd,
    exchangeRate: 135,
    currency: "dzd",
    status: "pending",
    mode: "test",
    checkoutUrl: "https://pay.chargily.net/test/checkout/" + checkoutId,
  }).returning();
  return i.id;
}

beforeAll(async () => {
  const mod = await import("../app");
  app = mod.default;
});

beforeEach(async () => {
  testUserId = await createTestUser();
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe("POST /webhooks/chargily — security", () => {
  it("rejects requests with no signature", async () => {
    const body = JSON.stringify({ id: "evt_x", type: "checkout.paid", data: { id: "co_x", status: "paid" } });
    const res = await request(app).post("/webhooks/chargily").set("Content-Type", "application/json").send(body);
    expect(res.status).toBe(401);
  });

  it("rejects requests with a bad signature", async () => {
    const body = JSON.stringify({ id: "evt_x", type: "checkout.paid", data: { id: "co_x", status: "paid" } });
    const res = await request(app)
      .post("/webhooks/chargily")
      .set("Content-Type", "application/json")
      .set("signature", "deadbeef".repeat(8))
      .send(body);
    expect(res.status).toBe(401);
  });

  it("rejects empty bodies", async () => {
    const res = await request(app)
      .post("/webhooks/chargily")
      .set("Content-Type", "application/json")
      .set("signature", sign(""))
      .send("");
    expect(res.status).toBe(400);
  });
});

describe("POST /webhooks/chargily — credit invariants", () => {
  it("credits topupCreditBalance exactly once per checkout (CAS prevents double-credit)", async () => {
    const checkoutId = `co_test_${Date.now()}`;
    const intentId = await createPendingIntent(testUserId, checkoutId, 7.4074);
    const eventId = `evt_${Date.now()}`;
    const body = JSON.stringify({
      id: eventId,
      type: "checkout.paid",
      data: { id: checkoutId, status: "paid" },
    });
    const sig = sign(body);

    // First delivery — credits.
    const res1 = await request(app)
      .post("/webhooks/chargily").set("Content-Type", "application/json").set("signature", sig).send(body);
    expect(res1.status).toBe(200);
    expect(res1.body).toMatchObject({ received: true, credited: true });

    const [user1] = await db.select().from(usersTable).where(eq(usersTable.id, testUserId));
    expect(Number(user1.topupCreditBalance)).toBeCloseTo(7.4074, 4);

    const [intent1] = await db.select().from(paymentIntentsTable).where(eq(paymentIntentsTable.id, intentId));
    expect(intent1.status).toBe("paid");
    expect(intent1.creditedAt).not.toBeNull();

    // Same event id replayed — UNIQUE on chargily_webhook_events.event_id stops it.
    const res2 = await request(app)
      .post("/webhooks/chargily").set("Content-Type", "application/json").set("signature", sig).send(body);
    expect(res2.status).toBe(200);
    expect(res2.body).toMatchObject({ duplicate: true });

    // Different event id but same checkout — CAS on status='pending' stops the credit.
    const eventId2 = `evt_${Date.now()}_2`;
    const body2 = JSON.stringify({
      id: eventId2, type: "checkout.paid", data: { id: checkoutId, status: "paid" },
    });
    const res3 = await request(app)
      .post("/webhooks/chargily").set("Content-Type", "application/json").set("signature", sign(body2)).send(body2);
    expect(res3.status).toBe(200);
    expect(res3.body).toMatchObject({ already_processed: true });

    const [user2] = await db.select().from(usersTable).where(eq(usersTable.id, testUserId));
    // Balance must NOT have doubled.
    expect(Number(user2.topupCreditBalance)).toBeCloseTo(7.4074, 4);
  });

  it("marks intent as failed/canceled/expired without crediting", async () => {
    const checkoutId = `co_fail_${Date.now()}`;
    const intentId = await createPendingIntent(testUserId, checkoutId);
    const eventId = `evt_fail_${Date.now()}`;
    const body = JSON.stringify({
      id: eventId, type: "checkout.failed", data: { id: checkoutId, status: "failed" },
    });
    const res = await request(app)
      .post("/webhooks/chargily").set("Content-Type", "application/json").set("signature", sign(body)).send(body);
    expect(res.status).toBe(200);

    const [intent] = await db.select().from(paymentIntentsTable).where(eq(paymentIntentsTable.id, intentId));
    expect(intent.status).toBe("failed");
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, testUserId));
    expect(Number(user.topupCreditBalance)).toBe(0);
  });

  it("returns 200 with unknown_checkout for an unrecognised checkout id", async () => {
    const eventId = `evt_unknown_${Date.now()}`;
    const body = JSON.stringify({
      id: eventId, type: "checkout.paid", data: { id: "co_does_not_exist_xyz", status: "paid" },
    });
    const res = await request(app)
      .post("/webhooks/chargily").set("Content-Type", "application/json").set("signature", sign(body)).send(body);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ unknown_checkout: true });
  });

  it("rejects malformed events (missing id or data.id)", async () => {
    const body = JSON.stringify({ id: "evt_y", type: "checkout.paid", data: {} });
    const res = await request(app)
      .post("/webhooks/chargily").set("Content-Type", "application/json").set("signature", sign(body)).send(body);
    expect(res.status).toBe(400);
  });
});

describe("Chargily webhook event log", () => {
  it("persists the event for audit (unique on event_id)", async () => {
    const checkoutId = `co_log_${Date.now()}`;
    await createPendingIntent(testUserId, checkoutId);
    const eventId = `evt_log_${Date.now()}`;
    const body = JSON.stringify({
      id: eventId, type: "checkout.paid", data: { id: checkoutId, status: "paid" },
    });
    await request(app)
      .post("/webhooks/chargily").set("Content-Type", "application/json").set("signature", sign(body)).send(body);

    const [logged] = await db
      .select()
      .from(chargilyWebhookEventsTable)
      .where(eq(chargilyWebhookEventsTable.eventId, eventId));
    expect(logged).toBeDefined();
    expect(logged.eventType).toBe("checkout.paid");
    expect(logged.payload).toBe(body);
  });
});
