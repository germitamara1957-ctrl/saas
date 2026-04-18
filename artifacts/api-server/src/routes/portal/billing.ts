import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db, paymentIntentsTable, usersTable, auditLogsTable } from "@workspace/db";
import { createCheckout, retrieveCheckout, ChargilyError, ChargilyConfigError } from "../../lib/chargily";
import { getChargilySettings, dzdToUsd } from "../../lib/chargilySettings";
import { logger } from "../../lib/logger";

const router: IRouter = Router();

/**
 * GET /portal/billing/config
 * Returns the live exchange rate + min/max so the UI can render previews
 * without making the user submit just to see the USD amount.
 */
router.get("/portal/billing/config", async (_req, res): Promise<void> => {
  const settings = await getChargilySettings();
  res.json({
    dzdToUsdRate: settings.dzdToUsdRate,
    minTopupDzd: settings.minTopupDzd,
    maxTopupDzd: settings.maxTopupDzd,
    mode: settings.mode,
    currency: "dzd",
    enabled: settings.enabled,
  });
});

/**
 * POST /portal/billing/topup { amountDzd: number }
 * Creates a Chargily checkout, persists a pending payment_intent, and
 * returns the redirect URL.
 */
router.post("/portal/billing/topup", async (req, res): Promise<void> => {
  const userId = Number(req.authUser!.sub);
  const { amountDzd } = req.body as { amountDzd?: unknown };

  const amount = Number(amountDzd);
  if (!Number.isFinite(amount) || amount <= 0) {
    res.status(400).json({ error: "amountDzd must be a positive number" });
    return;
  }

  const settings = await getChargilySettings();
  if (!settings.enabled) {
    res.status(403).json({ error: "Top-ups are currently disabled by the administrator" });
    return;
  }
  if (amount < settings.minTopupDzd) {
    res.status(400).json({ error: `Minimum top-up is ${settings.minTopupDzd} DZD` });
    return;
  }
  if (amount > settings.maxTopupDzd) {
    res.status(400).json({ error: `Maximum top-up is ${settings.maxTopupDzd} DZD` });
    return;
  }
  // Chargily DZD has no sub-unit — must be an integer.
  const amountInt = Math.round(amount);
  const amountUsd = dzdToUsd(amountInt, settings.dzdToUsdRate);

  const [user] = await db
    .select({ id: usersTable.id, email: usersTable.email, name: usersTable.name })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const baseUrl = (process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
  const successUrl = `${baseUrl}/portal/billing/result?status=success`;
  const failureUrl = `${baseUrl}/portal/billing/result?status=failure`;
  const webhookUrl = `${baseUrl}/webhooks/chargily`;

  let checkout;
  try {
    checkout = await createCheckout({
      amount: amountInt,
      currency: "dzd",
      success_url: successUrl,
      failure_url: failureUrl,
      webhook_endpoint: webhookUrl,
      description: `AI Gateway top-up · user #${userId} · ${amountInt} DZD → $${amountUsd.toFixed(2)} credits`,
      language: "ar",
      pass_fees_to_customer: true,
      metadata: { userId, amountUsd, exchangeRate: settings.dzdToUsdRate },
    });
  } catch (err) {
    if (err instanceof ChargilyConfigError) {
      logger.error({ err }, "Chargily not configured");
      res.status(503).json({ error: "Payment gateway is not configured. Please contact support." });
      return;
    }
    if (err instanceof ChargilyError) {
      logger.error({ err: err.message, status: err.status, body: err.body }, "Chargily checkout creation failed");
      res.status(502).json({ error: "Payment gateway error. Please try again later." });
      return;
    }
    throw err;
  }

  const [intent] = await db
    .insert(paymentIntentsTable)
    .values({
      userId,
      chargilyCheckoutId: checkout.id,
      amountDzd: amountInt,
      amountUsd,
      exchangeRate: settings.dzdToUsdRate,
      currency: "dzd",
      status: "pending",
      mode: settings.mode,
      checkoutUrl: checkout.checkout_url,
      metadata: JSON.stringify({ language: "ar" }),
    })
    .returning();

  await db.insert(auditLogsTable).values({
    action: "billing.topup.intent_created",
    actorId: userId,
    actorEmail: user.email,
    targetId: intent.id,
    details: JSON.stringify({ amountDzd: amountInt, amountUsd, checkoutId: checkout.id, mode: settings.mode }),
    ip: req.ip,
  });

  res.status(201).json({
    intentId: intent.id,
    checkoutId: checkout.id,
    checkoutUrl: checkout.checkout_url,
    amountDzd: amountInt,
    amountUsd,
    exchangeRate: settings.dzdToUsdRate,
    status: "pending",
  });
});

/**
 * GET /portal/billing/intents — list this user's payment intents (newest first).
 */
router.get("/portal/billing/intents", async (req, res): Promise<void> => {
  const userId = Number(req.authUser!.sub);
  const rows = await db
    .select({
      id: paymentIntentsTable.id,
      chargilyCheckoutId: paymentIntentsTable.chargilyCheckoutId,
      amountDzd: paymentIntentsTable.amountDzd,
      amountUsd: paymentIntentsTable.amountUsd,
      exchangeRate: paymentIntentsTable.exchangeRate,
      currency: paymentIntentsTable.currency,
      status: paymentIntentsTable.status,
      mode: paymentIntentsTable.mode,
      checkoutUrl: paymentIntentsTable.checkoutUrl,
      creditedAt: paymentIntentsTable.creditedAt,
      failureReason: paymentIntentsTable.failureReason,
      createdAt: paymentIntentsTable.createdAt,
    })
    .from(paymentIntentsTable)
    .where(eq(paymentIntentsTable.userId, userId))
    .orderBy(desc(paymentIntentsTable.createdAt))
    .limit(100);
  res.json(rows);
});

/**
 * GET /portal/billing/intents/:id — single intent (for polling after redirect).
 * If the intent is still pending and >30s old, refreshes from Chargily.
 */
router.get("/portal/billing/intents/:id", async (req, res): Promise<void> => {
  const userId = Number(req.authUser!.sub);
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid intent id" });
    return;
  }

  const [intent] = await db
    .select()
    .from(paymentIntentsTable)
    .where(and(eq(paymentIntentsTable.id, id), eq(paymentIntentsTable.userId, userId)))
    .limit(1);
  if (!intent) {
    res.status(404).json({ error: "Intent not found" });
    return;
  }

  // If still pending and >30s old, fetch the live status from Chargily as a
  // safety net for missed/delayed webhooks. The webhook is still authoritative
  // for crediting — this only updates the *display* status here.
  const ageMs = Date.now() - intent.createdAt.getTime();
  if (intent.status === "pending" && ageMs > 30_000) {
    try {
      const checkout = await retrieveCheckout(intent.chargilyCheckoutId);
      if ((checkout.status as string) !== "pending" && checkout.status !== intent.status) {
        // Don't credit here — only update the display field. The webhook
        // CAS-credits exactly once. If the webhook is missing entirely, an
        // admin can reconcile manually.
        await db
          .update(paymentIntentsTable)
          .set({ status: checkout.status === "paid" ? "pending" : checkout.status })
          .where(and(
            eq(paymentIntentsTable.id, id),
            eq(paymentIntentsTable.status, "pending"),
          ));
      }
    } catch (err) {
      logger.warn({ err, intentId: id }, "Chargily status refresh failed");
    }
  }

  res.json(intent);
});

export default router;
