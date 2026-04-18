/**
 * /portal/billing route tests — auth, validation, isolation. Mocks the
 * Chargily HTTP client so no real network call is made.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, usersTable, paymentIntentsTable } from "@workspace/db";
import { hashPassword } from "../lib/crypto";

process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test_jwt_secret_xxxxxxxxxxxxxxxx";
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.CHARGILY_SECRET_KEY = "test_secret_xxx";
process.env.CHARGILY_WEBHOOK_SECRET = "whsec_test";
process.env.CHARGILY_MODE = "test";

vi.mock("../lib/chargily", async (importActual) => {
  const actual = await importActual<typeof import("../lib/chargily")>();
  return {
    ...actual,
    createCheckout: vi.fn(async (input: { amount: number; currency: string }) => ({
      id: "co_mocked_" + Date.now() + "_" + Math.floor(Math.random() * 10000),
      entity: "checkout" as const,
      livemode: false,
      amount: input.amount,
      currency: input.currency,
      status: "pending" as const,
      checkout_url: "https://pay.chargily.net/test/checkout/co_mocked",
      customer_id: null, payment_link_id: null, invoice_id: null, payment_method: null,
      language: "ar", success_url: "x", failure_url: null, webhook_endpoint: null,
      description: null, metadata: null, fees: null, fees_on_customer: false,
      pass_fees_to_customer: true, created_at: 0, updated_at: 0,
    })),
    retrieveCheckout: vi.fn(),
  };
});

let app: import("express").Express;

async function loginAs(email: string, password: string): Promise<string> {
  const res = await request(app).post("/portal/auth/login").send({ email, password });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  // Cookie or body token
  const cookie = res.headers["set-cookie"]?.[0]?.split(";")[0];
  if (cookie) return cookie;
  return `auth_token=${res.body.token}`;
}

async function createUser(): Promise<{ id: number; email: string; password: string; cookie: string }> {
  const email = `billing-route-${Date.now()}-${Math.random()}@test.local`;
  const password = "Password123!";
  const [u] = await db.insert(usersTable).values({
    email,
    passwordHash: await hashPassword(password),
    name: "Test User",
    role: "developer",
    isActive: true,
    emailVerified: true,
  }).returning();
  const cookie = await loginAs(email, password);
  return { id: u.id, email, password, cookie };
}

beforeAll(async () => {
  const mod = await import("../app");
  app = mod.default;
});

describe("GET /portal/billing/config", () => {
  it("requires auth", async () => {
    const res = await request(app).get("/portal/billing/config");
    expect(res.status).toBe(401);
  });

  it("returns config for authed user", async () => {
    const u = await createUser();
    const res = await request(app).get("/portal/billing/config").set("Cookie", u.cookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      dzdToUsdRate: expect.any(Number),
      minTopupDzd: expect.any(Number),
      maxTopupDzd: expect.any(Number),
      mode: "test",
      currency: "dzd",
    });
  });
});

describe("POST /portal/billing/topup — validation", () => {
  let user: Awaited<ReturnType<typeof createUser>>;
  beforeEach(async () => { user = await createUser(); });

  it("rejects missing amount", async () => {
    const res = await request(app).post("/portal/billing/topup").set("Cookie", user.cookie).send({});
    expect(res.status).toBe(400);
  });

  it("rejects negative amount", async () => {
    const res = await request(app).post("/portal/billing/topup").set("Cookie", user.cookie).send({ amountDzd: -100 });
    expect(res.status).toBe(400);
  });

  it("rejects amount below minimum", async () => {
    const res = await request(app).post("/portal/billing/topup").set("Cookie", user.cookie).send({ amountDzd: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Minimum/);
  });

  it("rejects amount above maximum", async () => {
    const res = await request(app).post("/portal/billing/topup").set("Cookie", user.cookie).send({ amountDzd: 999_999_999 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Maximum/);
  });

  it("creates an intent and returns checkout URL on valid amount", async () => {
    const res = await request(app).post("/portal/billing/topup").set("Cookie", user.cookie).send({ amountDzd: 1000 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      intentId: expect.any(Number),
      checkoutUrl: expect.stringContaining("chargily.net"),
      amountDzd: 1000,
      status: "pending",
    });

    const [intent] = await db.select().from(paymentIntentsTable).where(eq(paymentIntentsTable.id, res.body.intentId));
    expect(intent.userId).toBe(user.id);
    expect(intent.status).toBe("pending");
    expect(intent.mode).toBe("test");
  });
});

describe("GET /portal/billing/intents — isolation", () => {
  it("only returns the requesting user's intents", async () => {
    const userA = await createUser();
    const userB = await createUser();

    await request(app).post("/portal/billing/topup").set("Cookie", userA.cookie).send({ amountDzd: 1000 });
    await request(app).post("/portal/billing/topup").set("Cookie", userB.cookie).send({ amountDzd: 2000 });

    const resA = await request(app).get("/portal/billing/intents").set("Cookie", userA.cookie);
    const resB = await request(app).get("/portal/billing/intents").set("Cookie", userB.cookie);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    const aHasA = (resA.body as { amountDzd: number }[]).some((i) => i.amountDzd === 1000);
    const aHasB = (resA.body as { amountDzd: number }[]).some((i) => i.amountDzd === 2000);
    const bHasA = (resB.body as { amountDzd: number }[]).some((i) => i.amountDzd === 1000);
    const bHasB = (resB.body as { amountDzd: number }[]).some((i) => i.amountDzd === 2000);

    expect(aHasA).toBe(true);
    expect(aHasB).toBe(false);
    expect(bHasA).toBe(false);
    expect(bHasB).toBe(true);
  });

  it("blocks reading another user's intent by id", async () => {
    const userA = await createUser();
    const userB = await createUser();
    const created = await request(app).post("/portal/billing/topup").set("Cookie", userA.cookie).send({ amountDzd: 1000 });
    const intentId = created.body.intentId as number;

    const res = await request(app).get(`/portal/billing/intents/${intentId}`).set("Cookie", userB.cookie);
    expect(res.status).toBe(404);
  });
});
