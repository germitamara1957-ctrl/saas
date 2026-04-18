/**
 * Chargily HTTP client unit tests — mock fetch, no real network.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const ORIG_ENV = { ...process.env };

beforeEach(() => {
  process.env.CHARGILY_SECRET_KEY = "test_secret_key_xxx";
  process.env.CHARGILY_WEBHOOK_SECRET = "whsec_test";
  process.env.CHARGILY_MODE = "test";
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...ORIG_ENV };
  vi.restoreAllMocks();
});

describe("chargily client — base URL", () => {
  it("uses the test base URL when CHARGILY_MODE=test", async () => {
    process.env.CHARGILY_MODE = "test";
    const mod = await import("../lib/chargily");
    expect(mod.getChargilyBaseUrl()).toBe("https://pay.chargily.net/test/api/v2");
  });

  it("uses the live base URL when CHARGILY_MODE=live", async () => {
    process.env.CHARGILY_MODE = "live";
    const mod = await import("../lib/chargily");
    expect(mod.getChargilyBaseUrl()).toBe("https://pay.chargily.net/api/v2");
  });

  it("defaults to test mode for any other value", async () => {
    process.env.CHARGILY_MODE = "anything-else";
    const mod = await import("../lib/chargily");
    expect(mod.getChargilyBaseUrl()).toBe("https://pay.chargily.net/test/api/v2");
  });
});

describe("chargily client — request behavior", () => {
  it("throws ChargilyConfigError when CHARGILY_SECRET_KEY is missing", async () => {
    delete process.env.CHARGILY_SECRET_KEY;
    const mod = await import("../lib/chargily");
    await expect(mod.createCustomer({ name: "x" })).rejects.toThrow(/CHARGILY_SECRET_KEY/);
  });

  it("sends Bearer auth header to the right URL", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "cust_1", entity: "customer" }), { status: 200 })
    );
    const mod = await import("../lib/chargily");
    await mod.createCustomer({ name: "Mahdi" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://pay.chargily.net/test/api/v2/customers");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test_secret_key_xxx");
  });

  it("retries on 5xx but not on 4xx", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "boom" }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "x", entity: "checkout" }), { status: 200 }));
    const mod = await import("../lib/chargily");
    const out = await mod.createCheckout({
      amount: 1000, currency: "dzd", success_url: "https://example.com/s",
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(out).toMatchObject({ id: "x" });
  });

  it("does NOT retry on 400", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ error: "bad" }), { status: 400 }));
    const mod = await import("../lib/chargily");
    await expect(mod.createCheckout({
      amount: 0, currency: "dzd", success_url: "https://example.com/s",
    })).rejects.toThrow();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("chargily client — webhook signature verification", () => {
  it("returns true for a valid HMAC-SHA256 signature", async () => {
    const crypto = await import("node:crypto");
    const mod = await import("../lib/chargily");
    const body = JSON.stringify({ id: "evt_1", type: "checkout.paid", data: { id: "co_1", status: "paid" } });
    const sig = crypto.createHmac("sha256", "whsec_test").update(body).digest("hex");
    expect(await mod.verifyWebhookSignature(body, sig)).toBe(true);
  });

  it("returns false for a tampered body", async () => {
    const crypto = await import("node:crypto");
    const mod = await import("../lib/chargily");
    const body = JSON.stringify({ id: "evt_1" });
    const sig = crypto.createHmac("sha256", "whsec_test").update(body).digest("hex");
    expect(await mod.verifyWebhookSignature(body + "tampered", sig)).toBe(false);
  });

  it("returns false for missing signature", async () => {
    const mod = await import("../lib/chargily");
    expect(await mod.verifyWebhookSignature("anything", undefined)).toBe(false);
    expect(await mod.verifyWebhookSignature("anything", "")).toBe(false);
  });

  it("returns false when webhook secret is missing", async () => {
    delete process.env.CHARGILY_WEBHOOK_SECRET;
    const mod = await import("../lib/chargily");
    mod.invalidateChargilySecretsCache();
    expect(await mod.verifyWebhookSignature("body", "deadbeef")).toBe(false);
  });

  it("uses constant-time comparison (different-length sigs fail without crash)", async () => {
    const mod = await import("../lib/chargily");
    expect(await mod.verifyWebhookSignature("body", "short")).toBe(false);
    expect(await mod.verifyWebhookSignature("body", "x".repeat(128))).toBe(false);
  });
});
