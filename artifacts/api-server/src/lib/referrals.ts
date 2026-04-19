import { eq, and, sql, sum, count, desc, inArray } from "drizzle-orm";
import { db, usersTable, referralEarningsTable } from "@workspace/db";
import { getSettingValue } from "../routes/admin/settings";
import { logger } from "./logger";

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // base31 — no I/L/O/0/1 to avoid confusion

export const REFERRAL_RATE_SETTING = "referral_rate";
export const REFERRAL_HOLD_DAYS_SETTING = "referral_hold_days";
export const REFERRAL_MIN_REDEEM_SETTING = "referral_min_redeem_usd";
export const REFERRALS_ENABLED_SETTING = "referrals_enabled";

export interface ReferralConfig {
  enabled: boolean;
  rate: number;          // e.g. 0.08
  holdDays: number;      // e.g. 14
  minRedeemUsd: number;  // e.g. 10
}

const DEFAULTS: ReferralConfig = { enabled: true, rate: 0.08, holdDays: 14, minRedeemUsd: 10 };

let cache: { value: ReferralConfig; expiresAt: number } | null = null;
const CACHE_TTL_MS = 60_000;

export function invalidateReferralConfigCache(): void {
  cache = null;
}

export async function getReferralConfig(): Promise<ReferralConfig> {
  if (cache && cache.expiresAt > Date.now()) return cache.value;
  const [enabled, rate, hold, minRedeem] = await Promise.all([
    getSettingValue(REFERRALS_ENABLED_SETTING),
    getSettingValue(REFERRAL_RATE_SETTING),
    getSettingValue(REFERRAL_HOLD_DAYS_SETTING),
    getSettingValue(REFERRAL_MIN_REDEEM_SETTING),
  ]);
  const parsedRate = rate != null ? Number(rate) : DEFAULTS.rate;
  const parsedHold = hold != null ? Number(hold) : DEFAULTS.holdDays;
  const parsedMin = minRedeem != null ? Number(minRedeem) : DEFAULTS.minRedeemUsd;
  const value: ReferralConfig = {
    enabled: enabled == null ? DEFAULTS.enabled : enabled !== "false",
    rate: Number.isFinite(parsedRate) && parsedRate >= 0 && parsedRate <= 1 ? parsedRate : DEFAULTS.rate,
    holdDays: Number.isFinite(parsedHold) && parsedHold >= 0 ? Math.floor(parsedHold) : DEFAULTS.holdDays,
    minRedeemUsd: Number.isFinite(parsedMin) && parsedMin >= 0 ? parsedMin : DEFAULTS.minRedeemUsd,
  };
  cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

function randomCode(len = 8): string {
  let out = "";
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  for (const b of buf) out += ALPHABET[b % ALPHABET.length];
  return out;
}

/**
 * Returns the user's referral code, generating + persisting one if missing.
 * Idempotent and safe under concurrent calls (uses unique constraint).
 */
export async function ensureReferralCode(userId: number): Promise<string> {
  const [row] = await db
    .select({ code: usersTable.referralCode })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (row?.code) return row.code;

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode(8);
    try {
      const [updated] = await db
        .update(usersTable)
        .set({ referralCode: code })
        .where(and(eq(usersTable.id, userId), sql`${usersTable.referralCode} IS NULL`))
        .returning({ code: usersTable.referralCode });
      if (updated?.code) return updated.code;
      // Another concurrent call already set it — read it back.
      const [fresh] = await db
        .select({ code: usersTable.referralCode })
        .from(usersTable)
        .where(eq(usersTable.id, userId))
        .limit(1);
      if (fresh?.code) return fresh.code;
    } catch (err) {
      // Unique collision — try again with a new random code.
      logger.debug({ err, attempt }, "Referral code collision, retrying");
    }
  }
  throw new Error("Failed to generate unique referral code");
}

/**
 * Looks up the userId for a referral code. Returns null if invalid.
 */
export async function findUserByReferralCode(code: string): Promise<number | null> {
  const cleaned = code.trim().toUpperCase();
  if (!/^[A-Z2-9]{4,16}$/.test(cleaned)) return null;
  const [row] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.referralCode, cleaned))
    .limit(1);
  return row?.id ?? null;
}

/**
 * Sets `referredBy` on a newly registered user. Refuses self-referral.
 * Called inside the registration transaction. Best-effort: silent on failure.
 */
export async function captureSignupReferral(
  newUserId: number,
  refCodeRaw: string | null | undefined,
): Promise<void> {
  if (!refCodeRaw) return;
  try {
    const referrerId = await findUserByReferralCode(String(refCodeRaw));
    if (!referrerId || referrerId === newUserId) return;
    await db
      .update(usersTable)
      .set({ referredBy: referrerId })
      .where(and(eq(usersTable.id, newUserId), sql`${usersTable.referredBy} IS NULL`));
  } catch (err) {
    logger.warn({ err, newUserId }, "captureSignupReferral failed (non-fatal)");
  }
}

/**
 * Records a pending commission earning for the referrer of `referredUserId`,
 * if any. `basisAmountUsd` is the ACTUAL USD revenue (plan price or top-up
 * USD value) — NEVER the credit value granted.
 *
 * Idempotent: if a row already exists for (sourceType, sourceId), no-op.
 * Returns the created earning row, or null if no referrer / disabled / dup.
 */
export async function recordReferralEarning(args: {
  referredUserId: number;
  sourceType: "topup" | "plan";
  sourceId: string | number;
  basisAmountUsd: number;
}): Promise<{ id: number; commissionUsd: number; referrerId: number } | null> {
  const { referredUserId, sourceType, sourceId, basisAmountUsd } = args;
  if (!Number.isFinite(basisAmountUsd) || basisAmountUsd <= 0) return null;

  const cfg = await getReferralConfig();
  if (!cfg.enabled || cfg.rate <= 0) return null;

  const [user] = await db
    .select({ referredBy: usersTable.referredBy })
    .from(usersTable)
    .where(eq(usersTable.id, referredUserId))
    .limit(1);
  const referrerId = user?.referredBy;
  if (!referrerId || referrerId === referredUserId) return null;

  const sourceIdStr = String(sourceId);
  const commissionUsd = Number((basisAmountUsd * cfg.rate).toFixed(8));
  const unlocksAt = new Date(Date.now() + cfg.holdDays * 24 * 60 * 60 * 1000);

  // DB-enforced idempotency via UNIQUE(source_type, source_id) + ON CONFLICT
  // DO NOTHING. This is race-safe: two concurrent webhook deliveries cannot
  // both succeed in inserting. If we win, .returning() yields a row; if we
  // lose, it yields nothing and we treat it as a duplicate.
  try {
    const [inserted] = await db
      .insert(referralEarningsTable)
      .values({
        referrerId,
        referredUserId,
        sourceType,
        sourceId: sourceIdStr,
        basisAmountUsd,
        commissionUsd,
        rate: cfg.rate,
        status: "pending",
        unlocksAt,
      })
      .onConflictDoNothing({ target: [referralEarningsTable.sourceType, referralEarningsTable.sourceId] })
      .returning({ id: referralEarningsTable.id });

    if (!inserted) {
      logger.debug({ sourceType, sourceId: sourceIdStr }, "Referral earning duplicate (race) — skipped");
      return null;
    }

    logger.info({
      earningId: inserted.id,
      referrerId,
      referredUserId,
      basisAmountUsd,
      commissionUsd,
      sourceType,
      sourceId: sourceIdStr,
    }, "Referral commission recorded");
    return { id: inserted.id, commissionUsd, referrerId };
  } catch (err) {
    logger.warn({ err, referredUserId, sourceType, sourceId }, "Failed to record referral earning");
    return null;
  }
}

/**
 * Reverses a previously-recorded referral earning. Called when a top-up
 * payment is refunded/disputed AFTER the commission was credited.
 *
 * Behavior depends on current status:
 *   - pending|available  → flip to 'reversed'. No money has moved yet.
 *   - redeemed           → flip to 'reversed' AND debit the referrer's
 *                          topupCreditBalance by `commissionUsd` (clawback).
 *                          Balance is allowed to go negative — admin/finance
 *                          will reconcile.
 *   - reversed           → no-op (idempotent).
 *
 * Returns { reversed: boolean, clawbackUsd: number }.
 */
export async function reverseReferralEarning(
  sourceType: "topup" | "plan",
  sourceId: string | number,
): Promise<{ reversed: boolean; clawbackUsd: number }> {
  const sourceIdStr = String(sourceId);

  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: referralEarningsTable.id,
        referrerId: referralEarningsTable.referrerId,
        commissionUsd: referralEarningsTable.commissionUsd,
        status: referralEarningsTable.status,
      })
      .from(referralEarningsTable)
      .where(and(
        eq(referralEarningsTable.sourceType, sourceType),
        eq(referralEarningsTable.sourceId, sourceIdStr),
      ))
      .for("update");

    if (!row || row.status === "reversed") {
      return { reversed: false, clawbackUsd: 0 };
    }

    const wasRedeemed = row.status === "redeemed";

    await tx
      .update(referralEarningsTable)
      .set({ status: "reversed" })
      .where(eq(referralEarningsTable.id, row.id));

    let clawback = 0;
    if (wasRedeemed) {
      clawback = Number(row.commissionUsd);
      await tx
        .update(usersTable)
        .set({ topupCreditBalance: sql`${usersTable.topupCreditBalance} - ${clawback}` })
        .where(eq(usersTable.id, row.referrerId));
      logger.warn({
        earningId: row.id,
        referrerId: row.referrerId,
        clawbackUsd: clawback,
        sourceType,
        sourceId: sourceIdStr,
      }, "Referral commission clawback applied");
    } else {
      logger.info({
        earningId: row.id,
        referrerId: row.referrerId,
        sourceType,
        sourceId: sourceIdStr,
      }, "Referral commission reversed (no clawback — not yet redeemed)");
    }

    return { reversed: true, clawbackUsd: clawback };
  });
}

/**
 * Promotes `pending` earnings whose `unlocks_at` has passed to `available`.
 * Safe to call repeatedly. Returns count promoted.
 */
export async function promotePendingEarnings(): Promise<number> {
  const updated = await db
    .update(referralEarningsTable)
    .set({ status: "available" })
    .where(and(
      eq(referralEarningsTable.status, "pending"),
      sql`${referralEarningsTable.unlocksAt} <= now()`,
    ))
    .returning({ id: referralEarningsTable.id });
  return updated.length;
}

export interface ReferralStats {
  referredCount: number;
  pendingUsd: number;
  availableUsd: number;
  redeemedUsd: number;
  reversedUsd: number;
  lifetimeUsd: number;
}

export async function getReferrerStats(referrerId: number): Promise<ReferralStats> {
  // Lazy-promote anything ripe before computing stats — keeps users honest in
  // the UI without a cron job.
  await promotePendingEarnings();

  const [referredCountRow] = await db
    .select({ c: count() })
    .from(usersTable)
    .where(eq(usersTable.referredBy, referrerId));

  const groups = await db
    .select({
      status: referralEarningsTable.status,
      total: sum(referralEarningsTable.commissionUsd),
    })
    .from(referralEarningsTable)
    .where(eq(referralEarningsTable.referrerId, referrerId))
    .groupBy(referralEarningsTable.status);

  const byStatus: Record<string, number> = {};
  let lifetime = 0;
  for (const g of groups) {
    const v = Number(g.total ?? 0);
    byStatus[g.status] = v;
    if (g.status !== "reversed") lifetime += v;
  }

  return {
    referredCount: Number(referredCountRow?.c ?? 0),
    pendingUsd: byStatus.pending ?? 0,
    availableUsd: byStatus.available ?? 0,
    redeemedUsd: byStatus.redeemed ?? 0,
    reversedUsd: byStatus.reversed ?? 0,
    lifetimeUsd: lifetime,
  };
}

export async function getRecentEarnings(referrerId: number, limit = 20) {
  return db
    .select({
      id: referralEarningsTable.id,
      sourceType: referralEarningsTable.sourceType,
      basisAmountUsd: referralEarningsTable.basisAmountUsd,
      commissionUsd: referralEarningsTable.commissionUsd,
      status: referralEarningsTable.status,
      unlocksAt: referralEarningsTable.unlocksAt,
      redeemedAt: referralEarningsTable.redeemedAt,
      createdAt: referralEarningsTable.createdAt,
    })
    .from(referralEarningsTable)
    .where(eq(referralEarningsTable.referrerId, referrerId))
    .orderBy(desc(referralEarningsTable.createdAt))
    .limit(limit);
}

/**
 * Atomically redeems all `available` earnings for a user, crediting the
 * total to their `topupCreditBalance`. Enforces minRedeemUsd. Uses CAS-style
 * UPDATE so that concurrent redeems can't double-credit.
 */
export async function redeemAvailableEarnings(referrerId: number): Promise<{
  ok: boolean;
  reason?: string;
  redeemedUsd?: number;
  count?: number;
}> {
  const cfg = await getReferralConfig();
  await promotePendingEarnings();

  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: referralEarningsTable.id, commissionUsd: referralEarningsTable.commissionUsd })
      .from(referralEarningsTable)
      .where(and(
        eq(referralEarningsTable.referrerId, referrerId),
        eq(referralEarningsTable.status, "available"),
      ))
      .for("update");

    if (rows.length === 0) {
      return { ok: false, reason: "No available earnings to redeem" };
    }

    const total = rows.reduce((s, r) => s + Number(r.commissionUsd), 0);
    if (total < cfg.minRedeemUsd) {
      return {
        ok: false,
        reason: `Minimum redemption is $${cfg.minRedeemUsd.toFixed(2)} (you have $${total.toFixed(2)})`,
      };
    }

    const ids = rows.map(r => r.id);
    const updated = await tx
      .update(referralEarningsTable)
      .set({ status: "redeemed", redeemedAt: new Date() })
      .where(and(
        eq(referralEarningsTable.referrerId, referrerId),
        eq(referralEarningsTable.status, "available"),
        inArray(referralEarningsTable.id, ids),
      ))
      .returning({ id: referralEarningsTable.id });

    if (updated.length !== rows.length) {
      throw new Error("Concurrent redeem detected — aborting");
    }

    await tx
      .update(usersTable)
      .set({ topupCreditBalance: sql`${usersTable.topupCreditBalance} + ${total}` })
      .where(eq(usersTable.id, referrerId));

    return { ok: true, redeemedUsd: total, count: updated.length };
  });
}
