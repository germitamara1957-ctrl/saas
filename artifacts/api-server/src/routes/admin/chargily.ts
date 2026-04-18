import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, paymentIntentsTable, systemSettingsTable, auditLogsTable } from "@workspace/db";
import {
  retrieveBalance,
  ChargilyConfigError,
  ChargilyError,
  getChargilySecretsStatus,
  invalidateChargilySecretsCache,
  CHARGILY_SECRET_KEY_SETTING,
  CHARGILY_WEBHOOK_SECRET_SETTING,
} from "../../lib/chargily";
import { getChargilySettings, CHARGILY_ENABLED_SETTING } from "../../lib/chargilySettings";
import { encryptApiKey } from "../../lib/crypto";
import { getSettingValue } from "./settings";
import { logger } from "../../lib/logger";

/** Strict host-allowlist: scheme must be http/https, host must be a valid hostname[:port]. */
function sanitizeBaseUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

/**
 * Builds the public webhook URL the admin pastes into Chargily.
 * Priority: (1) admin-configured app_base_url setting (trusted), (2) the
 * APP_BASE_URL env, (3) Express's req.protocol+req.hostname (NOT raw forwarded
 * headers — those are spoofable). Returns a clear placeholder if nothing valid
 * is available so the admin sees they must configure app_base_url.
 */
async function buildWebhookUrl(req: { protocol: string; hostname: string }): Promise<string> {
  const fromSetting = sanitizeBaseUrl(await getSettingValue("app_base_url"));
  if (fromSetting) return `${fromSetting}/webhooks/chargily`;
  const fromEnv = sanitizeBaseUrl(process.env.APP_BASE_URL);
  if (fromEnv) return `${fromEnv}/webhooks/chargily`;
  const proto = req.protocol === "http" || req.protocol === "https" ? req.protocol : "https";
  const host = req.hostname;
  if (!host) return "Configure app_base_url in settings to generate webhook URL";
  return `${proto}://${host}/webhooks/chargily`;
}

const router: IRouter = Router();

/**
 * GET /admin/billing/chargily/balance
 * Reads the live wallet balance from Chargily so admins can monitor.
 */
router.get("/admin/billing/chargily/balance", async (_req, res): Promise<void> => {
  try {
    const balance = await retrieveBalance();
    res.json(balance);
  } catch (err) {
    if (err instanceof ChargilyConfigError) {
      res.status(503).json({ error: "Chargily not configured" });
      return;
    }
    if (err instanceof ChargilyError) {
      logger.error({ err: err.message, status: err.status }, "Chargily balance fetch failed");
      res.status(502).json({ error: "Chargily error", details: err.body });
      return;
    }
    throw err;
  }
});

/**
 * GET /admin/billing/chargily/settings
 * Returns the current admin-editable settings.
 */
router.get("/admin/billing/chargily/settings", async (_req, res): Promise<void> => {
  const settings = await getChargilySettings();
  res.json(settings);
});

/**
 * POST /admin/billing/chargily/settings
 * Updates dzdToUsdRate, minTopupDzd, maxTopupDzd. CHARGILY_MODE remains
 * env-controlled (it's a deployment concern, not a runtime toggle).
 */
router.post("/admin/billing/chargily/settings", async (req, res): Promise<void> => {
  const { dzdToUsdRate, minTopupDzd, maxTopupDzd } = req.body as {
    dzdToUsdRate?: unknown;
    minTopupDzd?: unknown;
    maxTopupDzd?: unknown;
  };

  const updates: { key: string; value: string }[] = [];
  function pick(key: string, raw: unknown, label: string, min: number, max: number): boolean {
    if (raw === undefined) return true;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) {
      res.status(400).json({ error: `${label} must be a positive number` });
      return false;
    }
    if (n < min || n > max) {
      res.status(400).json({ error: `${label} must be between ${min} and ${max}` });
      return false;
    }
    updates.push({ key, value: String(n) });
    return true;
  }

  // Bounded ranges prevent typos that would massively over-credit (e.g. rate=0.1).
  if (!pick("chargily_dzd_to_usd_rate", dzdToUsdRate, "dzdToUsdRate", 50, 1000)) return;
  if (!pick("chargily_min_topup_dzd", minTopupDzd, "minTopupDzd", 100, 100_000)) return;
  if (!pick("chargily_max_topup_dzd", maxTopupDzd, "maxTopupDzd", 1000, 10_000_000)) return;

  // Optional `enabled` toggle — accepts boolean or the string "true"/"false".
  const enabledRaw = (req.body as { enabled?: unknown }).enabled;
  if (enabledRaw !== undefined) {
    const truthy =
      enabledRaw === true || enabledRaw === "true" || enabledRaw === 1 || enabledRaw === "1";
    const falsy =
      enabledRaw === false || enabledRaw === "false" || enabledRaw === 0 || enabledRaw === "0";
    if (!truthy && !falsy) {
      res.status(400).json({ error: "enabled must be a boolean" });
      return;
    }
    updates.push({ key: CHARGILY_ENABLED_SETTING, value: truthy ? "true" : "false" });
  }

  for (const { key, value } of updates) {
    await db
      .insert(systemSettingsTable)
      .values({ key, value, encrypted: false })
      .onConflictDoUpdate({ target: systemSettingsTable.key, set: { value } });
  }

  await db.insert(auditLogsTable).values({
    action: "admin.chargily.settings_updated",
    actorId: Number(req.authUser!.sub),
    actorEmail: req.authUser!.email,
    details: JSON.stringify({ updates: updates.map(u => ({ key: u.key, value: u.value })) }),
    ip: req.ip,
  });

  const fresh = await getChargilySettings();
  res.json(fresh);
});

/**
 * GET /admin/billing/chargily/intents
 * Lists all payment intents across users (admin oversight).
 */
router.get("/admin/billing/chargily/intents", async (req, res): Promise<void> => {
  const limit = Math.min(parseInt(String(req.query.limit ?? "200"), 10) || 200, 500);
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const baseQuery = db
    .select()
    .from(paymentIntentsTable)
    .orderBy(desc(paymentIntentsTable.createdAt))
    .limit(limit);
  const rows = status
    ? await baseQuery.where(eq(paymentIntentsTable.status, status))
    : await baseQuery;
  res.json(rows);
});

/**
 * GET /admin/billing/chargily/secrets
 * Returns whether each Chargily secret is configured (without revealing values)
 * and the auto-generated webhook URL the admin must paste into Chargily.
 */
router.get("/admin/billing/chargily/secrets", async (req, res): Promise<void> => {
  const status = await getChargilySecretsStatus();
  res.json({
    ...status,
    webhookUrl: await buildWebhookUrl(req),
  });
});

/**
 * PUT /admin/billing/chargily/secrets
 * Stores the Chargily secret key and/or webhook secret in the encrypted
 * system_settings table. Empty/omitted fields are NOT touched. Sending an
 * explicit `null` clears the stored value (env fallback then takes over).
 */
router.put("/admin/billing/chargily/secrets", async (req, res): Promise<void> => {
  const { secretKey, webhookSecret } = req.body as {
    secretKey?: string | null;
    webhookSecret?: string | null;
  };

  const writes: Array<{ key: string; value: string | null; label: string }> = [];
  if (secretKey !== undefined) {
    writes.push({ key: CHARGILY_SECRET_KEY_SETTING, value: secretKey, label: "secretKey" });
  }
  if (webhookSecret !== undefined) {
    writes.push({ key: CHARGILY_WEBHOOK_SECRET_SETTING, value: webhookSecret, label: "webhookSecret" });
  }
  if (writes.length === 0) {
    res.status(400).json({ error: "Provide secretKey and/or webhookSecret" });
    return;
  }

  const updatedKeys: string[] = [];
  for (const w of writes) {
    if (w.value === null || (typeof w.value === "string" && w.value.trim() === "")) {
      // Clear stored value → env fallback takes over.
      await db.delete(systemSettingsTable).where(eq(systemSettingsTable.key, w.key));
      updatedKeys.push(`${w.label}:cleared`);
      continue;
    }
    if (typeof w.value !== "string") {
      res.status(400).json({ error: `${w.label} must be a string or null` });
      return;
    }
    const trimmed = w.value.trim();
    if (trimmed.length < 8) {
      res.status(400).json({ error: `${w.label} looks too short` });
      return;
    }
    const encrypted = encryptApiKey(trimmed);
    await db
      .insert(systemSettingsTable)
      .values({ key: w.key, value: encrypted, encrypted: true })
      .onConflictDoUpdate({
        target: systemSettingsTable.key,
        set: { value: encrypted, encrypted: true },
      });
    updatedKeys.push(`${w.label}:set`);
  }

  invalidateChargilySecretsCache();

  await db.insert(auditLogsTable).values({
    action: "admin.chargily.secrets_updated",
    actorId: Number(req.authUser!.sub),
    actorEmail: req.authUser!.email,
    details: JSON.stringify({ updates: updatedKeys }),
    ip: req.ip,
  });

  const status = await getChargilySecretsStatus();
  res.json({ ...status, webhookUrl: await buildWebhookUrl(req) });
});

export default router;
