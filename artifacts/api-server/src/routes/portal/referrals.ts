import { Router, type IRouter } from "express";
import {
  ensureReferralCode,
  getReferralConfig,
  getReferrerStats,
  getRecentEarnings,
  redeemAvailableEarnings,
} from "../../lib/referrals";
import { db, usersTable, auditLogsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../../lib/logger";

const router: IRouter = Router();

async function getAppBaseUrl(req: { protocol: string; hostname: string }): Promise<string> {
  const fromEnv = process.env.APP_BASE_URL?.trim();
  if (fromEnv) {
    try {
      const u = new URL(fromEnv);
      if (u.protocol === "http:" || u.protocol === "https:") return `${u.protocol}//${u.host}`;
    } catch { /* ignore */ }
  }
  return `${req.protocol}://${req.hostname}`;
}

/**
 * GET /portal/referrals
 * Returns the user's referral code, share link, config, stats, and recent
 * earnings history (last 20).
 */
router.get("/portal/referrals", async (req, res): Promise<void> => {
  const userId = Number(req.authUser!.sub);
  try {
    const [config, code] = await Promise.all([
      getReferralConfig(),
      ensureReferralCode(userId),
    ]);

    if (!config.enabled) {
      res.json({
        enabled: false,
        code,
        link: null,
        rate: config.rate,
        holdDays: config.holdDays,
        minRedeemUsd: config.minRedeemUsd,
        stats: { referredCount: 0, pendingUsd: 0, availableUsd: 0, redeemedUsd: 0, reversedUsd: 0, lifetimeUsd: 0 },
        recent: [],
      });
      return;
    }

    const [stats, recent, userRow] = await Promise.all([
      getReferrerStats(userId),
      getRecentEarnings(userId, 20),
      db
        .select({ emailVerified: usersTable.emailVerified })
        .from(usersTable)
        .where(eq(usersTable.id, userId))
        .limit(1),
    ]);

    const baseUrl = await getAppBaseUrl(req);
    const link = `${baseUrl}/signup?ref=${encodeURIComponent(code)}`;

    res.json({
      enabled: true,
      code,
      link,
      rate: config.rate,
      holdDays: config.holdDays,
      minRedeemUsd: config.minRedeemUsd,
      emailVerified: Boolean(userRow[0]?.emailVerified),
      stats,
      recent,
    });
  } catch (err) {
    logger.error({ err, userId }, "GET /portal/referrals failed");
    res.status(500).json({ error: "Failed to load referrals" });
  }
});

/**
 * POST /portal/referrals/redeem
 * Converts available earnings to topup credit balance.
 */
router.post("/portal/referrals/redeem", async (req, res): Promise<void> => {
  const userId = Number(req.authUser!.sub);
  try {
    const [userRow] = await db
      .select({ emailVerified: usersTable.emailVerified })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    if (!userRow?.emailVerified) {
      res.status(403).json({
        error: "EMAIL_NOT_VERIFIED",
        message: "Verify your email before redeeming referral earnings.",
        messageAr: "يجب توثيق بريدك الإلكتروني قبل سحب رصيد الإحالة.",
      });
      return;
    }

    const result = await redeemAvailableEarnings(userId);
    if (!result.ok) {
      res.status(400).json({ error: result.reason ?? "Redeem failed" });
      return;
    }

    await db.insert(auditLogsTable).values({
      action: "referral.redeem",
      actorId: userId,
      actorEmail: req.authUser!.email,
      details: JSON.stringify({ redeemedUsd: result.redeemedUsd, count: result.count }),
      ip: req.ip,
    });

    // Return the new balance so the UI can refresh without a second round-trip.
    const [user] = await db
      .select({ topupCreditBalance: usersTable.topupCreditBalance })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    res.json({
      ok: true,
      redeemedUsd: result.redeemedUsd,
      count: result.count,
      newTopupBalance: Number(user?.topupCreditBalance ?? 0),
    });
  } catch (err) {
    logger.error({ err, userId }, "POST /portal/referrals/redeem failed");
    res.status(500).json({ error: "Failed to redeem" });
  }
});

export default router;
