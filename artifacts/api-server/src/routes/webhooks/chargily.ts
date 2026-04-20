import { Router, type IRouter, type Request } from "express";
import express from "express";
import { eq, and, sql } from "drizzle-orm";
import {
  db,
  paymentIntentsTable,
  chargilyWebhookEventsTable,
  usersTable,
  auditLogsTable,
  plansTable,
  apiKeysTable,
} from "@workspace/db";
import { isNull } from "drizzle-orm";
import { verifyWebhookSignature } from "../../lib/chargily";
import { generateApiKey, encryptApiKey } from "../../lib/crypto";
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

      // Branch on intent purpose: top-up (default) or plan upgrade.
      let purpose: "topup" | "plan_upgrade" = "topup";
      let targetPlanId: number | null = null;
      // Tracks what to record as the referral earning AFTER successful
      // fulfillment. For plan upgrades the basis is plan.priceUsd (actual
      // money paid for the plan), for top-ups it's the credited USD amount.
      // If the plan-upgrade falls back to top-up (plan deleted), we record
      // it as a top-up earning instead.
      let referralBasis: { sourceType: "topup" | "plan"; basisAmountUsd: number } = {
        sourceType: "topup",
        basisAmountUsd: Number(credited.amountUsd),
      };
      try {
        const meta = intent.metadata ? JSON.parse(intent.metadata) as { purpose?: string; planId?: number } : null;
        if (meta?.purpose === "plan_upgrade" && Number.isInteger(meta.planId)) {
          purpose = "plan_upgrade";
          targetPlanId = meta.planId!;
        }
      } catch {
        // Malformed metadata → treat as top-up.
      }

      // Reliability: if any post-CAS fulfillment step throws, we revert the
      // intent status back to "pending" and remove the dedup row so Chargily's
      // retry can attempt fulfillment again. Without this, a transient DB error
      // mid-fulfillment would permanently lose the paid event.
      try {
      if (purpose === "plan_upgrade" && targetPlanId !== null) {
        const [plan] = await db
          .select()
          .from(plansTable)
          .where(and(eq(plansTable.id, targetPlanId), eq(plansTable.isActive, true)))
          .limit(1);

        if (!plan) {
          // Plan was deleted between checkout and webhook — fall back to crediting.
          logger.warn({ intentId: credited.id, planId: targetPlanId }, "Plan no longer active — crediting top-up balance instead");
          await db
            .update(usersTable)
            .set({ topupCreditBalance: sql`${usersTable.topupCreditBalance} + ${credited.amountUsd}` })
            .where(eq(usersTable.id, credited.userId));
          // Fall back to top-up earning since user got top-up credit, not a plan.
          referralBasis = { sourceType: "topup", basisAmountUsd: Number(credited.amountUsd) };
        } else {
          // Enroll user — same logic as POST /portal/plans/:planId/enroll.
          const existingKeys = await db
            .select()
            .from(apiKeysTable)
            .where(and(
              eq(apiKeysTable.userId, credited.userId),
              eq(apiKeysTable.isActive, true),
              isNull(apiKeysTable.organizationId),
            ))
            .limit(10);

          const planlessKey = existingKeys.find(k => k.planId === null);
          const alreadyOnPlan = existingKeys.find(k => k.planId === targetPlanId);

          if (alreadyOnPlan) {
            // User already on this plan — top up monthly credits to extend the period.
            const now = new Date();
            const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
            await db.update(usersTable).set({
              currentPlanId: targetPlanId,
              currentPeriodStartedAt: now,
              currentPeriodEnd: periodEnd,
              ...(plan.monthlyCredits > 0 ? { creditBalance: sql`credit_balance + ${plan.monthlyCredits}` } : {}),
            }).where(eq(usersTable.id, credited.userId));
          } else if (planlessKey) {
            await db.transaction(async (tx) => {
              await tx.update(apiKeysTable)
                .set({ planId: targetPlanId })
                .where(eq(apiKeysTable.id, planlessKey.id));
              const now = new Date();
              const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
              const userUpdate: Record<string, unknown> = {
                currentPlanId: targetPlanId,
                currentPeriodStartedAt: now,
                currentPeriodEnd: periodEnd,
              };
              if (plan.monthlyCredits > 0) {
                userUpdate["creditBalance"] = sql`credit_balance + ${plan.monthlyCredits}`;
              }
              await tx.update(usersTable).set(userUpdate).where(eq(usersTable.id, credited.userId));
            });
          } else {
            const { rawKey, keyHash, keyPrefix } = generateApiKey();
            const keyEncrypted = encryptApiKey(rawKey);
            await db.transaction(async (tx) => {
              await tx.insert(apiKeysTable).values({
                userId: credited.userId,
                planId: targetPlanId,
                keyPrefix,
                keyHash,
                keyEncrypted,
                name: `${plan.name} Key`,
                isActive: true,
              });
              const now = new Date();
              const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
              const userUpdate: Record<string, unknown> = {
                currentPlanId: targetPlanId,
                currentPeriodStartedAt: now,
                currentPeriodEnd: periodEnd,
              };
              if (plan.monthlyCredits > 0) {
                userUpdate["creditBalance"] = sql`credit_balance + ${plan.monthlyCredits}`;
              }
              await tx.update(usersTable).set(userUpdate).where(eq(usersTable.id, credited.userId));
            });
          }

          await db.insert(auditLogsTable).values({
            action: "billing.plan_upgrade.activated",
            actorId: credited.userId,
            targetId: credited.id,
            details: JSON.stringify({
              amountUsd: credited.amountUsd,
              planId: targetPlanId,
              planName: plan.name,
              checkoutId,
              eventId,
            }),
            ip: req.ip,
          });

          logger.info({ intentId: credited.id, userId: credited.userId, planId: targetPlanId }, "Chargily plan upgrade activated");
          // Plan-upgrade earning: basis is the plan's USD list price.
          referralBasis = { sourceType: "plan", basisAmountUsd: Number(plan.priceUsd) };
        }
      } else {
        // Default: credit the user's top-up balance. Using SQL arithmetic avoids
        // a race where two parallel updates would clobber each other.
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
      }
      } catch (fulfillErr) {
        // Revert the CAS so a retried webhook can re-attempt fulfillment.
        // Also remove the dedup row so the retry is not short-circuited as duplicate.
        logger.error({ err: fulfillErr, intentId: credited.id, eventId }, "Chargily fulfillment failed — reverting for retry");
        try {
          await db
            .update(paymentIntentsTable)
            .set({ status: "pending", creditedAt: null, webhookReceivedAt: null })
            .where(and(eq(paymentIntentsTable.id, credited.id), eq(paymentIntentsTable.status, "paid")));
          await db
            .delete(chargilyWebhookEventsTable)
            .where(eq(chargilyWebhookEventsTable.eventId, eventId));
        } catch (revertErr) {
          logger.error({ err: revertErr, intentId: credited.id, eventId }, "Chargily fulfillment revert failed");
        }
        // 500 → Chargily will retry per its delivery policy.
        res.status(500).json({ error: "Fulfillment failed; please retry" });
        return;
      }

      // Referral commission (Phase 1) — basis is the actual USD revenue
      // (NOT the credit value granted to the user). Failure here must not
      // affect the credit operation, so we swallow errors.
      try {
        const { recordReferralEarning } = await import("../../lib/referrals");
        await recordReferralEarning({
          referredUserId: credited.userId,
          sourceType: referralBasis.sourceType,
          sourceId: credited.id,
          basisAmountUsd: referralBasis.basisAmountUsd,
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
        // Earning was recorded as either "topup" or "plan" depending on the
        // intent's purpose; only one will exist for this sourceId. Try both —
        // the non-matching call is a no-op.
        const [r1, r2] = await Promise.all([
          reverseReferralEarning("topup", intent.id),
          reverseReferralEarning("plan", intent.id),
        ]);
        const result = r1.reversed ? r1 : r2;
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
