import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, paymentIntentsTable, systemSettingsTable, auditLogsTable } from "@workspace/db";
import { retrieveBalance, ChargilyConfigError, ChargilyError } from "../../lib/chargily";
import { getChargilySettings } from "../../lib/chargilySettings";
import { logger } from "../../lib/logger";

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

export default router;
