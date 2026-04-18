/**
 * Chargily Pay V2 HTTP client.
 *
 * Docs: https://dev.chargily.com/pay-v2/api-reference/introduction
 *
 * Auth: `Authorization: Bearer <CHARGILY_SECRET_KEY>`.
 * Mode is selected by the base URL — "test" for sandbox, "live" for production.
 *
 * Webhook signatures: HMAC-SHA256 of the raw request body, keyed with
 * `CHARGILY_WEBHOOK_SECRET`, sent in the `signature` header. Verification
 * uses constant-time comparison to defeat timing attacks.
 */
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db, systemSettingsTable } from "@workspace/db";
import { logger } from "./logger";
import { decryptApiKey } from "./crypto";

const TEST_BASE_URL = "https://pay.chargily.net/test/api/v2";
const LIVE_BASE_URL = "https://pay.chargily.net/api/v2";

export const CHARGILY_SECRET_KEY_SETTING = "chargily_secret_key";
export const CHARGILY_WEBHOOK_SECRET_SETTING = "chargily_webhook_secret";

export type ChargilyMode = "test" | "live";

export class ChargilyError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export class ChargilyConfigError extends Error {}

function getMode(): ChargilyMode {
  const mode = (process.env.CHARGILY_MODE ?? "test").toLowerCase();
  return mode === "live" ? "live" : "test";
}

export function getChargilyBaseUrl(mode: ChargilyMode = getMode()): string {
  return mode === "live" ? LIVE_BASE_URL : TEST_BASE_URL;
}

// In-memory cache (process-local) — invalidated on admin update.
// TTL also flushes the cache after 60s for multi-instance safety.
interface CacheEntry { value: string; expiresAt: number; }
const secretCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;

export function invalidateChargilySecretsCache(): void {
  secretCache.clear();
}

async function readSettingFromDb(key: string): Promise<string | null> {
  try {
    const [row] = await db
      .select({ value: systemSettingsTable.value, encrypted: systemSettingsTable.encrypted })
      .from(systemSettingsTable)
      .where(eq(systemSettingsTable.key, key))
      .limit(1);
    if (!row || !row.value) return null;
    if (row.encrypted) return decryptApiKey(row.value);
    return row.value;
  } catch (err) {
    logger.error({ err, key }, "Failed to read Chargily setting from DB");
    return null;
  }
}

async function readSecret(settingKey: string, envKey: string): Promise<string | null> {
  const cached = secretCache.get(settingKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  // DB takes precedence so admin-saved values override deployment env vars.
  const fromDb = await readSettingFromDb(settingKey);
  const value = fromDb ?? process.env[envKey] ?? null;
  if (value && value.trim()) {
    const trimmed = value.trim();
    secretCache.set(settingKey, { value: trimmed, expiresAt: Date.now() + CACHE_TTL_MS });
    return trimmed;
  }
  return null;
}

async function getSecretKey(): Promise<string> {
  const key = await readSecret(CHARGILY_SECRET_KEY_SETTING, "CHARGILY_SECRET_KEY");
  if (!key) {
    throw new ChargilyConfigError(
      "CHARGILY_SECRET_KEY is not configured. Add it from the admin Settings page or set the environment variable.",
    );
  }
  return key;
}

async function getWebhookSecret(): Promise<string> {
  const secret = await readSecret(CHARGILY_WEBHOOK_SECRET_SETTING, "CHARGILY_WEBHOOK_SECRET");
  if (!secret) {
    throw new ChargilyConfigError(
      "CHARGILY_WEBHOOK_SECRET is not configured. Add it from the admin Settings page or set the environment variable.",
    );
  }
  return secret;
}

/** Returns whether each Chargily secret is configured (DB or env). Does NOT reveal the actual values. */
export async function getChargilySecretsStatus(): Promise<{
  hasSecretKey: boolean;
  hasWebhookSecret: boolean;
  secretKeySource: "db" | "env" | "missing";
  webhookSecretSource: "db" | "env" | "missing";
  mode: ChargilyMode;
}> {
  const dbKey = await readSettingFromDb(CHARGILY_SECRET_KEY_SETTING);
  const dbWh = await readSettingFromDb(CHARGILY_WEBHOOK_SECRET_SETTING);
  const envKey = process.env.CHARGILY_SECRET_KEY?.trim();
  const envWh = process.env.CHARGILY_WEBHOOK_SECRET?.trim();
  return {
    hasSecretKey: Boolean(dbKey || envKey),
    hasWebhookSecret: Boolean(dbWh || envWh),
    secretKeySource: dbKey ? "db" : envKey ? "env" : "missing",
    webhookSecretSource: dbWh ? "db" : envWh ? "env" : "missing",
    mode: getMode(),
  };
}

interface RequestOptions {
  method?: "GET" | "POST" | "DELETE";
  body?: Record<string, unknown>;
  query?: Record<string, string | number | undefined>;
  /** Number of retries on 5xx / network errors. Default 2 (so 3 attempts total). */
  retries?: number;
  signal?: AbortSignal;
}

async function chargilyRequest<T>(
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  const { method = "GET", body, query, retries = 2, signal } = opts;
  const baseUrl = getChargilyBaseUrl();
  const secretKey = await getSecretKey();

  const url = new URL(`${baseUrl}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${secretKey}`,
    Accept: "application/json",
  };
  let bodyStr: string | undefined;
  if (body) {
    headers["Content-Type"] = "application/json";
    bodyStr = JSON.stringify(body);
  }

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      const combinedSignal = signal
        ? AbortSignal.any([controller.signal, signal])
        : controller.signal;

      const res = await fetch(url.toString(), {
        method,
        headers,
        body: bodyStr,
        signal: combinedSignal,
      });
      clearTimeout(timeout);

      const text = await res.text();
      let parsed: unknown = null;
      if (text) {
        try { parsed = JSON.parse(text); } catch { parsed = text; }
      }

      if (!res.ok) {
        // Retry on 5xx; bail on 4xx (caller's fault).
        if (res.status >= 500 && attempt < retries) {
          lastErr = new ChargilyError(
            `Chargily ${method} ${path} returned ${res.status}`,
            res.status,
            parsed,
          );
          await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
          continue;
        }
        throw new ChargilyError(
          `Chargily ${method} ${path} returned ${res.status}`,
          res.status,
          parsed,
        );
      }
      return parsed as T;
    } catch (err) {
      lastErr = err;
      if (err instanceof ChargilyError && err.status < 500) throw err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Chargily request failed");
}

// ── Customers ────────────────────────────────────────────────────────────────
export interface ChargilyCustomer {
  id: string;
  entity: "customer";
  livemode: boolean;
  name: string;
  email: string | null;
  phone: string | null;
  address: { country: string; state: string; address: string } | null;
  metadata: unknown;
  created_at: number;
  updated_at: number;
}

export interface CreateCustomerInput {
  name: string;
  email?: string;
  phone?: string;
  address?: { country: string; state?: string; address?: string };
  metadata?: Record<string, unknown>;
}

export async function createCustomer(input: CreateCustomerInput): Promise<ChargilyCustomer> {
  return chargilyRequest<ChargilyCustomer>("/customers", { method: "POST", body: { ...input } });
}

export async function retrieveCustomer(id: string): Promise<ChargilyCustomer> {
  return chargilyRequest<ChargilyCustomer>(`/customers/${encodeURIComponent(id)}`);
}

// ── Checkouts ────────────────────────────────────────────────────────────────
export interface ChargilyCheckout {
  id: string;
  entity: "checkout";
  livemode: boolean;
  amount: number;
  currency: string;
  status: "pending" | "paid" | "failed" | "canceled" | "expired";
  customer_id: string | null;
  payment_link_id: string | null;
  invoice_id: string | null;
  payment_method: string | null;
  language: string | null;
  success_url: string;
  failure_url: string | null;
  webhook_endpoint: string | null;
  description: string | null;
  metadata: unknown;
  fees: number | null;
  fees_on_customer: boolean;
  checkout_url: string;
  pass_fees_to_customer: boolean | null;
  created_at: number;
  updated_at: number;
}

export interface CreateCheckoutInput {
  /** Amount in the smallest currency unit (DZD has no sub-unit, so this is whole DZD). */
  amount: number;
  currency: "dzd" | "eur" | "usd";
  success_url: string;
  failure_url?: string;
  webhook_endpoint?: string;
  customer_id?: string;
  description?: string;
  language?: "ar" | "en" | "fr";
  payment_method?: "edahabia" | "cib";
  pass_fees_to_customer?: boolean;
  metadata?: Record<string, unknown>;
}

export async function createCheckout(input: CreateCheckoutInput): Promise<ChargilyCheckout> {
  return chargilyRequest<ChargilyCheckout>("/checkouts", { method: "POST", body: { ...input } });
}

export async function retrieveCheckout(id: string): Promise<ChargilyCheckout> {
  return chargilyRequest<ChargilyCheckout>(`/checkouts/${encodeURIComponent(id)}`);
}

// ── Balance ──────────────────────────────────────────────────────────────────
export interface ChargilyWallet {
  currency: string;
  balance: number;
  ready_for_payout: number | string;
  on_hold: number;
}

export interface ChargilyBalance {
  entity: "balance";
  livemode: boolean;
  wallets: ChargilyWallet[];
}

export async function retrieveBalance(): Promise<ChargilyBalance> {
  return chargilyRequest<ChargilyBalance>("/balance");
}

// ── Webhook signature verification ───────────────────────────────────────────
/**
 * Verifies a Chargily webhook signature using constant-time comparison.
 * The signature header is the hex HMAC-SHA256 of the raw request body.
 *
 * @param rawBody Raw request body as received (Buffer or string). MUST be the
 *                untouched bytes — `JSON.stringify(req.body)` is NOT acceptable
 *                because key ordering and whitespace would differ.
 * @param signatureHeader Value of the `signature` header.
 * @returns true if the signature matches, false otherwise.
 */
export async function verifyWebhookSignature(
  rawBody: Buffer | string,
  signatureHeader: string | undefined | null,
): Promise<boolean> {
  if (!signatureHeader || typeof signatureHeader !== "string") return false;
  let secret: string;
  try { secret = await getWebhookSecret(); } catch (err) {
    logger.error({ err }, "Chargily webhook secret not configured");
    return false;
  }
  const buf = typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody;
  const expected = crypto.createHmac("sha256", secret).update(buf).digest("hex");
  const expectedBuf = Buffer.from(expected, "utf8");
  const receivedBuf = Buffer.from(signatureHeader.trim(), "utf8");
  if (expectedBuf.length !== receivedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, receivedBuf);
}

export const __testing__ = { TEST_BASE_URL, LIVE_BASE_URL, getMode };
