import { Router, type IRouter, type Request } from "express";
import express from "express";
import { eq, and, sql } from "drizzle-orm";
import {
  db,
  paymentIntentsTable,
  chargilyWebhookEventsTable,
  usersTable,
  auditLogsTable,
} from "@workspace/db";
import { verifyWebhookSignature } from "../../lib/chargily";
import { logger } from "../../lib/logger";

const router: IRouter = Router();

/**
 * POST /webhooks/chargily
 *
 * Receives checkout-event webhooks from Chargily Pay V2.
 *
 * Security:
 *   1. We use express.raw() so HMAC verification operates on the exact bytes
 *      Chargily signed (re-stringifying req.body is unsafe).
 *   2. Signature is verified with constant-time HMAC-SHA256 comparison.
 *   3. The (eventId) is recorded in chargily_webhook_events with a UNIQUE
 *      constraint, so duplicate deliveries are rejected at the DB level.
 *
 * Idempotency:
 *   Crediting `topupCreditBalance` is gated by a CAS UPDATE on
 *   payment_intents (status = 'pending'). Concurrent webhook deliveries
 *   cannot double-credit because only the first UPDATE returns a row.
 */
router.post(
  "/webhooks/chargily",
  // Raw body parser is mounted at the path level in app.ts, before
  // express.json(), so req.body is a Buffer here.
  async (req: Request, res): Promise<void> => {
    const rawBody = req.body as Buffer;
    const signature = req.headers["signature"] as string | undefined;

    if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) {
      res.status(400).json({ error: "Empty body" });
      return;
    }

    if (!(await verifyWebhookSignature(rawBody, signature))) {
      logger.warn({ ip: req.ip, hasSig: Boolean(signature) }, "Chargily webhook: bad signature");
      res.status(401).json({ error: "Invalid signature" });
      return;
    }

    let event: { id?: string; type?: string; data?: { id?: string; status?: string; metadata?: unknown } };
    try {
      event = JSON.parse(rawBody.toString("utf8"));
    } catch {
      res.status(400).json({ error: "Invalid JSON" });
      return;
    }

    const eventId = typeof event.id === "string" ? event.id : null;
    const eventType = typeof event.type === "string" ? event.type : "unknown";
    const checkoutId = event.data?.id;
    const checkoutStatus = event.data?.status;

    if (!eventId || !checkoutId || typeof checkoutId !== "string") {
      logger.warn({ event }, "Chargily webhook: malformed event");
      res.status(400).json({ error: "Malformed event" });
      return;
    }

    // Replay protection — UNIQUE on event_id makes this atomic.
    try {
      await db.insert(chargilyWebhookEventsTable).values({
        eventId,
        eventType,
        signature: signature ?? "",
        payload: rawBody.toString("utf8"),
      });
    } catch (err) {
      // Duplicate event_id → already processed. Return 200 so Chargily stops retrying.
      logger.info({ eventId }, "Chargily webhook: duplicate event ignored");
      res.status(200).json({ received: true, duplicate: true });
      return;
    }

    // Look up the matching intent (must be ours).
    const [intent] = await db
      .select()
      .from(paymentIntentsTable)
      .where(eq(paymentIntentsTable.chargilyCheckoutId, checkoutId))
      .limit(1);
    if (!intent) {
      logger.warn({ checkoutId, eventId }, "Chargily webhook: unknown checkout id");
      // Still 200 — we logged the event; nothing to credit.
      res.status(200).json({ received: true, unknown_checkout: true });
      return;
    }

    // Defense-in-depth: ensure the gateway mode reported in the payload matches
    // the mode locked in the intent. Prevents test-mode events from crediting
    // live-mode intents (or vice versa) even in the unlikely case of a leak.
    const livemode = (event.data as { livemode?: unknown })?.livemode;
    if (typeof livemode === "boolean") {
      const expectedMode: "live" | "test" = livemode ? "live" : "test";
      if (expectedMode !== intent.mode) {
        logger.error(
          { intentId: intent.id, intentMode: intent.mode, payloadMode: expectedMode, eventId },
          "Chargily webhook: mode mismatch — refusing to credit",
        );
        res.status(200).json({ received: true, mode_mismatch: true });
        return;
      }
    }

    if (checkoutStatus === "paid") {
      // CAS: only credit if still pending. If a duplicate webhook beat us,
      // .returning() yields zero rows and we skip the credit.
      const updated = await db
        .update(paymentIntentsTable)
        .set({
          status: "paid",
          webhookReceivedAt: new Date(),
          creditedAt: new Date(),
        })
        .where(and(
          eq(paymentIntentsTable.id, intent.id),
          eq(paymentIntentsTable.status, "pending"),
        ))
        .returning({ id: paymentIntentsTable.id, amountUsd: paymentIntentsTable.amountUsd, userId: paymentIntentsTable.userId });

      if (updated.length === 0) {
        logger.info({ intentId: intent.id, currentStatus: intent.status }, "Chargily webhook: intent not pending — skipping credit");
        res.status(200).json({ received: true, already_processed: true });
        return;
      }

      const credited = updated[0];
      // Atomically credit the user's topup balance. Using SQL arithmetic
      // avoids a race where two parallel updates would clobber each other.
      await db
        .update(usersTable)
        .set({
          topupCreditBalance: sql`${usersTable.topupCreditBalance} + ${credited.amountUsd}`,
        })
        .where(eq(usersTable.id, credited.userId));

      await db.insert(auditLogsTable).values({
        action: "billing.topup.credited",
        actorId: credited.userId,
        targetId: credited.id,
        details: JSON.stringify({
          amountUsd: credited.amountUsd,
          checkoutId,
          eventId,
        }),
        ip: req.ip,
      });

      logger.info({ intentId: credited.id, userId: credited.userId, amountUsd: credited.amountUsd }, "Chargily top-up credited");

      // Referral commission (Phase 1) — basis is the actual USD revenue
      // (NOT the credit value granted to the user). Failure here must not
      // affect the credit operation, so we swallow errors.
      try {
        const { recordReferralEarning } = await import("../../lib/referrals");
        await recordReferralEarning({
          referredUserId: credited.userId,
          sourceType: "topup",
          sourceId: credited.id,
          basisAmountUsd: Number(credited.amountUsd),
        });
      } catch (err) {
        logger.warn({ err, intentId: credited.id }, "Referral earning recording failed (non-fatal)");
      }

      res.status(200).json({ received: true, credited: true });
      return;
    }

    if (checkoutStatus === "failed" || checkoutStatus === "canceled" || checkoutStatus === "expired") {
      await db
        .update(paymentIntentsTable)
        .set({
          status: checkoutStatus,
          webhookReceivedAt: new Date(),
          failureReason: `Chargily reported: ${checkoutStatus}`,
        })
        .where(and(
          eq(paymentIntentsTable.id, intent.id),
          eq(paymentIntentsTable.status, "pending"),
        ));
      res.status(200).json({ received: true, status: checkoutStatus });
      return;
    }

    // Refund/dispute path — Chargily reports a previously-paid intent as
    // refunded or disputed. We mark the intent and clawback any referral
    // commission tied to it. We do NOT debit the user's topup balance here
    // because refund-money-flow is handled out-of-band by finance/admin.
    if (checkoutStatus === "refunded" || checkoutStatus === "disputed") {
      await db
        .update(paymentIntentsTable)
        .set({
          status: checkoutStatus,
          webhookReceivedAt: new Date(),
          failureReason: `Chargily reported: ${checkoutStatus}`,
        })
        .where(eq(paymentIntentsTable.id, intent.id));

      try {
        const { reverseReferralEarning } = await import("../../lib/referrals");
        const result = await reverseReferralEarning("topup", intent.id);
        if (result.reversed) {
          await db.insert(auditLogsTable).values({
            action: "referral.reversed",
            actorId: intent.userId,
            targetId: intent.id,
            details: JSON.stringify({
              reason: checkoutStatus,
              clawbackUsd: result.clawbackUsd,
              checkoutId,
              eventId,
            }),
            ip: req.ip,
          });
        }
      } catch (err) {
        logger.error({ err, intentId: intent.id }, "Referral reversal failed");
      }

      res.status(200).json({ received: true, status: checkoutStatus });
      return;
    }

    // Unknown status — record it but don't change anything.
    logger.info({ checkoutStatus, eventType }, "Chargily webhook: status not actionable");
    res.status(200).json({ received: true });
  },
);

export default router;
