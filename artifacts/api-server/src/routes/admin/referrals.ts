import { Router, type IRouter } from "express";
import { db, usersTable, referralEarningsTable, systemSettingsTable, auditLogsTable } from "@workspace/db";
import { eq, desc, sql, and } from "drizzle-orm";
import {
  REFERRAL_RATE_SETTING,
  REFERRAL_HOLD_DAYS_SETTING,
  REFERRAL_MIN_REDEEM_SETTING,
  REFERRALS_ENABLED_SETTING,
  reverseReferralEarning,
} from "../../lib/referrals";
import { logger } from "../../lib/logger";

const router: IRouter = Router();

interface AuthedRequest extends Express.Request {
  user?: { id: number; email: string };
}

async function readSetting(key: string): Promise<string | null> {
  const [row] = await db
    .select({ value: systemSettingsTable.value })
    .from(systemSettingsTable)
    .where(eq(systemSettingsTable.key, key))
    .limit(1);
  return row?.value ?? null;
}

async function writeSetting(key: string, value: string): Promise<void> {
  await db
    .insert(systemSettingsTable)
    .values({ key, value, encrypted: false })
    .onConflictDoUpdate({ target: systemSettingsTable.key, set: { value, updatedAt: new Date() } });
}

router.get("/admin/referrals", async (_req, res): Promise<void> => {
  // Settings
  const [rate, holdDays, minRedeem, enabled] = await Promise.all([
    readSetting(REFERRAL_RATE_SETTING),
    readSetting(REFERRAL_HOLD_DAYS_SETTING),
    readSetting(REFERRAL_MIN_REDEEM_SETTING),
    readSetting(REFERRALS_ENABLED_SETTING),
  ]);

  // Top referrers (group by referrer_id)
  const topReferrers = await db
    .select({
      referrerId: referralEarningsTable.referrerId,
      email: usersTable.email,
      name: usersTable.name,
      referralCode: usersTable.referralCode,
      pendingUsd: sql<string>`COALESCE(SUM(CASE WHEN ${referralEarningsTable.status} = 'pending'   THEN ${referralEarningsTable.commissionUsd} ELSE 0 END), 0)`,
      availableUsd: sql<string>`COALESCE(SUM(CASE WHEN ${referralEarningsTable.status} = 'available' THEN ${referralEarningsTable.commissionUsd} ELSE 0 END), 0)`,
      redeemedUsd: sql<string>`COALESCE(SUM(CASE WHEN ${referralEarningsTable.status} = 'redeemed'  THEN ${referralEarningsTable.commissionUsd} ELSE 0 END), 0)`,
      reversedUsd: sql<string>`COALESCE(SUM(CASE WHEN ${referralEarningsTable.status} = 'reversed'  THEN ${referralEarningsTable.commissionUsd} ELSE 0 END), 0)`,
      lifetimeUsd: sql<string>`COALESCE(SUM(${referralEarningsTable.commissionUsd}), 0)`,
      earningCount: sql<number>`COUNT(*)::int`,
    })
    .from(referralEarningsTable)
    .innerJoin(usersTable, eq(usersTable.id, referralEarningsTable.referrerId))
    .groupBy(referralEarningsTable.referrerId, usersTable.email, usersTable.name, usersTable.referralCode)
    .orderBy(desc(sql`SUM(${referralEarningsTable.commissionUsd})`))
    .limit(50);

  // Recent earnings
  const recent = await db
    .select({
      id: referralEarningsTable.id,
      referrerEmail: sql<string>`referrer.email`,
      referredEmail: sql<string>`referred.email`,
      sourceType: referralEarningsTable.sourceType,
      sourceId: referralEarningsTable.sourceId,
      basisAmountUsd: referralEarningsTable.basisAmountUsd,
      commissionUsd: referralEarningsTable.commissionUsd,
      status: referralEarningsTable.status,
      unlocksAt: referralEarningsTable.unlocksAt,
      createdAt: referralEarningsTable.createdAt,
    })
    .from(referralEarningsTable)
    .innerJoin(sql`${usersTable} AS referrer`, sql`referrer.id = ${referralEarningsTable.referrerId}`)
    .innerJoin(sql`${usersTable} AS referred`, sql`referred.id = ${referralEarningsTable.referredUserId}`)
    .orderBy(desc(referralEarningsTable.createdAt))
    .limit(100);

  // Totals
  const [totals] = await db
    .select({
      totalEarnings: sql<number>`COUNT(*)::int`,
      totalReferrers: sql<number>`COUNT(DISTINCT ${referralEarningsTable.referrerId})::int`,
      pendingUsd: sql<string>`COALESCE(SUM(CASE WHEN ${referralEarningsTable.status} = 'pending'   THEN ${referralEarningsTable.commissionUsd} ELSE 0 END), 0)`,
      availableUsd: sql<string>`COALESCE(SUM(CASE WHEN ${referralEarningsTable.status} = 'available' THEN ${referralEarningsTable.commissionUsd} ELSE 0 END), 0)`,
      paidUsd: sql<string>`COALESCE(SUM(CASE WHEN ${referralEarningsTable.status} = 'redeemed'  THEN ${referralEarningsTable.commissionUsd} ELSE 0 END), 0)`,
      reversedUsd: sql<string>`COALESCE(SUM(CASE WHEN ${referralEarningsTable.status} = 'reversed'  THEN ${referralEarningsTable.commissionUsd} ELSE 0 END), 0)`,
    })
    .from(referralEarningsTable);

  // Total users with codes (referrers) and total referred users.
  const [usage] = await db
    .select({
      usersWithCode: sql<number>`COUNT(*) FILTER (WHERE ${usersTable.referralCode} IS NOT NULL)::int`,
      referredUsers: sql<number>`COUNT(*) FILTER (WHERE ${usersTable.referredBy} IS NOT NULL)::int`,
    })
    .from(usersTable);

  res.json({
    settings: {
      enabled: enabled === "true",
      rate: rate ? Number(rate) : 0.08,
      holdDays: holdDays ? Number(holdDays) : 14,
      minRedeemUsd: minRedeem ? Number(minRedeem) : 10,
    },
    totals: {
      totalEarnings: totals?.totalEarnings ?? 0,
      totalReferrers: totals?.totalReferrers ?? 0,
      pendingUsd: Number(totals?.pendingUsd ?? 0),
      availableUsd: Number(totals?.availableUsd ?? 0),
      paidUsd: Number(totals?.paidUsd ?? 0),
      reversedUsd: Number(totals?.reversedUsd ?? 0),
      usersWithCode: usage?.usersWithCode ?? 0,
      referredUsers: usage?.referredUsers ?? 0,
    },
    topReferrers: topReferrers.map((r) => ({
      ...r,
      pendingUsd: Number(r.pendingUsd),
      availableUsd: Number(r.availableUsd),
      redeemedUsd: Number(r.redeemedUsd),
      reversedUsd: Number(r.reversedUsd),
      lifetimeUsd: Number(r.lifetimeUsd),
    })),
    recent: recent.map((r) => ({
      ...r,
      basisAmountUsd: Number(r.basisAmountUsd),
      commissionUsd: Number(r.commissionUsd),
    })),
  });
});

router.patch("/admin/referrals/settings", async (req, res): Promise<void> => {
  const { enabled, rate, holdDays, minRedeemUsd } = req.body as {
    enabled?: unknown;
    rate?: unknown;
    holdDays?: unknown;
    minRedeemUsd?: unknown;
  };
  const actorId = (req as AuthedRequest).user?.id;

  const changes: Record<string, string> = {};

  if (typeof enabled === "boolean") {
    await writeSetting(REFERRALS_ENABLED_SETTING, enabled ? "true" : "false");
    changes.enabled = String(enabled);
  }
  if (typeof rate === "number" && rate >= 0 && rate <= 1) {
    await writeSetting(REFERRAL_RATE_SETTING, String(rate));
    changes.rate = String(rate);
  } else if (rate !== undefined) {
    res.status(400).json({ error: "rate must be a number between 0 and 1" });
    return;
  }
  if (typeof holdDays === "number" && Number.isInteger(holdDays) && holdDays >= 0 && holdDays <= 365) {
    await writeSetting(REFERRAL_HOLD_DAYS_SETTING, String(holdDays));
    changes.holdDays = String(holdDays);
  } else if (holdDays !== undefined) {
    res.status(400).json({ error: "holdDays must be an integer between 0 and 365" });
    return;
  }
  if (typeof minRedeemUsd === "number" && minRedeemUsd >= 0) {
    await writeSetting(REFERRAL_MIN_REDEEM_SETTING, String(minRedeemUsd));
    changes.minRedeemUsd = String(minRedeemUsd);
  } else if (minRedeemUsd !== undefined) {
    res.status(400).json({ error: "minRedeemUsd must be a non-negative number" });
    return;
  }

  if (Object.keys(changes).length > 0 && actorId) {
    await db.insert(auditLogsTable).values({
      action: "referral.settings.update",
      actorId,
      details: JSON.stringify(changes),
      ip: req.ip,
    });
  }

  res.json({ ok: true, changes });
});

router.post("/admin/referrals/:id/reverse", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "invalid id" });
    return;
  }
  const actorId = (req as AuthedRequest).user?.id;

  const [row] = await db
    .select({
      sourceType: referralEarningsTable.sourceType,
      sourceId: referralEarningsTable.sourceId,
    })
    .from(referralEarningsTable)
    .where(eq(referralEarningsTable.id, id))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "earning not found" });
    return;
  }

  try {
    const result = await reverseReferralEarning(row.sourceType as "topup" | "plan", row.sourceId);
    if (actorId) {
      await db.insert(auditLogsTable).values({
        action: "referral.manual.reverse",
        actorId,
        targetId: id,
        details: JSON.stringify({ ...result, sourceType: row.sourceType, sourceId: row.sourceId }),
        ip: req.ip,
      });
    }
    res.json({ ok: true, ...result });
  } catch (err) {
    logger.error({ err, id }, "Manual referral reverse failed");
    res.status(500).json({ error: "reversal failed" });
  }
});

export default router;
// Suppress unused-import warnings — these symbols may be used by future endpoints.
void and;
