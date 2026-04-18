/**
 * Regression tests for the three fixes from Session 30 round-2 review:
 *   1. SSRF redirect bypass in webhook delivery
 *   2. Idempotency CAS (claim_token) protection on terminal SQL
 *   3. /portal/me + /portal/me/export org-key isolation
 *
 * The webhook test exercises real behaviour by stubbing global fetch.
 * The other two are source-level invariants — they read the implementation
 * file and assert that the security-critical clauses are still present, so
 * future edits cannot silently drop them without failing CI.
 */

import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

beforeAll(() => {
  vi.stubEnv("JWT_SECRET", "test-jwt-secret-for-testing-only-32chars");
  vi.stubEnv("ENCRYPTION_KEY", "0".repeat(64));
  vi.stubEnv("NODE_ENV", "test");
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. SSRF redirect bypass — webhookDispatcher.sendSingleWebhook must reject a
//    30x response that points at a private/loopback/metadata target.
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => ({
  db: { update: () => ({ set: () => ({ where: () => Promise.resolve() }) }) },
  webhooksTable: { id: "id" },
}));

describe("Regression: SSRF redirect bypass on webhook delivery", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("rejects a 302 redirect that points at AWS instance metadata", async () => {
    // First (and only legitimate) fetch returns 302 → metadata IP.
    // If the manual-redirect loop is ever reverted to redirect:"follow",
    // the SSRF guard would never see this hop and the test would fail.
    globalThis.fetch = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: "http://169.254.169.254/latest/meta-data/" },
    })) as unknown as typeof fetch;

    const { sendSingleWebhook } = await import("../lib/webhookDispatcher");
    const result = await sendSingleWebhook(
      { id: 1, url: "https://example.com/hook", secret: "s", events: [] },
      { event: "usage.success", timestamp: new Date().toISOString(), data: {} },
    );

    expect(result.ok).toBe(false);
    expect(result.error ?? "").toMatch(/SSRF/i);
    // We must have reached fetch exactly once (the redirect hop is blocked
    // BEFORE the second fetch is issued).
    expect((globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length)
      .toBe(1);
  });

  it("rejects a 301 redirect that points at loopback", async () => {
    globalThis.fetch = vi.fn(async () => new Response(null, {
      status: 301,
      headers: { location: "http://127.0.0.1:8080/admin" },
    })) as unknown as typeof fetch;

    const { sendSingleWebhook } = await import("../lib/webhookDispatcher");
    const result = await sendSingleWebhook(
      { id: 2, url: "https://example.com/hook", secret: "s", events: [] },
      { event: "usage.error", timestamp: new Date().toISOString(), data: {} },
    );

    expect(result.ok).toBe(false);
    expect(result.error ?? "").toMatch(/SSRF/i);
  });

  it("caps redirect chains at MAX_REDIRECTS hops", async () => {
    // Every fetch returns 302 → another public URL. The dispatcher must give
    // up after MAX_REDIRECTS instead of looping forever.
    globalThis.fetch = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: "https://example.org/next" },
    })) as unknown as typeof fetch;

    const { sendSingleWebhook } = await import("../lib/webhookDispatcher");
    const result = await sendSingleWebhook(
      { id: 3, url: "https://example.com/hook", secret: "s", events: [] },
      { event: "usage.success", timestamp: new Date().toISOString(), data: {} },
    );

    expect(result.ok).toBe(false);
    // Must mention either "redirect" cap or fall back to the SSRF/timeout path.
    expect(result.error ?? "").toMatch(/redirect|timeout|SSRF/i);
    // And MUST NOT have made an unbounded number of calls.
    const callCount = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(callCount).toBeLessThanOrEqual(10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Idempotency CAS — every terminal SQL statement that mutates an
//    idempotency_keys row MUST gate on `claim_token = ${ourToken}` so a
//    stale-takeover by a new owner cannot be overwritten by the old owner.
// ─────────────────────────────────────────────────────────────────────────────

describe("Regression: idempotency middleware uses claim_token CAS", () => {
  const file = readFileSync(
    join(__dirname, "../middlewares/idempotency.ts"),
    "utf8",
  );

  it("declares the claim_token column", () => {
    expect(file).toMatch(/ADD COLUMN IF NOT EXISTS claim_token/i);
  });

  it("tryClaim INSERTs a fresh per-request token", () => {
    expect(file).toMatch(/crypto\.randomBytes\(16\)\.toString\("hex"\)/);
    // The INSERT must persist the token in the claim_token column.
    expect(file).toMatch(/INSERT INTO idempotency_keys[\s\S]+claim_token/i);
  });

  it("tryTakeover is a CAS UPDATE (no DELETE+INSERT race window)", () => {
    expect(file).toMatch(/UPDATE idempotency_keys[\s\S]+claim_token = \$\{oldClaimToken\}/);
    expect(file).not.toMatch(/DELETE FROM idempotency_keys[\s\S]+is_pending = TRUE\s*`\)\s*;\s*owned/);
  });

  it("every terminal mutation is gated on claim_token = ${ourToken}", () => {
    // Match every UPDATE/DELETE on the idempotency_keys table.
    const mutations = [...file.matchAll(/(UPDATE|DELETE)\s+(?:FROM\s+)?idempotency_keys[\s\S]*?`/gi)];
    expect(mutations.length).toBeGreaterThanOrEqual(4); // finalize + 5xx + oversize + close-handler

    for (const [snippet] of mutations) {
      // The takeover and the lazy GC are the only SQL blocks allowed to
      // skip the claim_token check (takeover swaps tokens; GC deletes by
      // expires_at). Identify them and skip.
      const isTakeover = /SET\s+claim_token\s*=\s*\$\{newClaimToken\}/i.test(snippet);
      const isGc = /WHERE\s+expires_at\s*<\s*NOW\(\)/i.test(snippet);
      if (isTakeover || isGc) continue;

      expect(snippet, `terminal mutation missing claim_token gate:\n${snippet}`)
        .toMatch(/claim_token\s*=\s*\$\{ourToken\}/);
    }
  });

  it("PENDING_TIMEOUT_MS is generously larger than any handler timeout", () => {
    // Must be at least 15 minutes — anything less risks taking over a still-running video job.
    const m = file.match(/PENDING_TIMEOUT_MS\s*=\s*(\d+)\s*\*\s*(\d+)\s*\*\s*(\d+)/);
    expect(m, "PENDING_TIMEOUT_MS literal not found").not.toBeNull();
    const ms = Number(m![1]) * Number(m![2]) * Number(m![3]);
    expect(ms).toBeGreaterThanOrEqual(15 * 60 * 1000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Org-key isolation — every personal-key query in routes/portal/me.ts must
//    apply isNull(apiKeysTable.organizationId) so org-scoped keys never leak
//    through personal endpoints.
// ─────────────────────────────────────────────────────────────────────────────

describe("Regression: /portal/me filters out org-scoped api keys", () => {
  const file = readFileSync(
    join(__dirname, "../routes/portal/me.ts"),
    "utf8",
  );

  it("imports isNull from drizzle-orm", () => {
    expect(file).toMatch(/import\s*\{[^}]*\bisNull\b[^}]*\}\s*from\s*["']drizzle-orm["']/);
  });

  it("every apiKeysTable read filters by isNull(organizationId)", () => {
    // Find every `.from(apiKeysTable)` call and verify the surrounding query
    // also references isNull(apiKeysTable.organizationId) within ~30 lines.
    const lines = file.split("\n");
    const fromIdx: number[] = [];
    lines.forEach((line, i) => {
      if (/\.from\(apiKeysTable\)/.test(line)) fromIdx.push(i);
    });

    expect(fromIdx.length).toBeGreaterThan(0);

    for (const idx of fromIdx) {
      const window = lines.slice(Math.max(0, idx - 5), idx + 30).join("\n");
      expect(window, `apiKeysTable query at line ${idx + 1} missing isNull(organizationId):\n${window}`)
        .toMatch(/isNull\(\s*apiKeysTable\.organizationId\s*\)/);
    }
  });
});
