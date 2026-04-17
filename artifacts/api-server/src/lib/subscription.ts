import { db, usersTable, organizationsTable, plansTable } from "@workspace/db";
import { and, eq, isNotNull, lte, sql } from "drizzle-orm";
import { logger } from "./logger";

export const DEFAULT_PERIOD_DAYS = 30;

export function periodEndFromNow(days = DEFAULT_PERIOD_DAYS): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

export function isSubscriptionActive(periodEnd: Date | null | undefined): boolean {
  if (!periodEnd) return false;
  return periodEnd.getTime() > Date.now();
}

/**
 * Daily rollover.
 *
 * Free plans (priceUsd = 0) auto-renew: fresh 30-day window + credit_balance
 * replaced with plan.monthlyCredits.
 *
 * Paid plans (priceUsd > 0) lapse: credit_balance is zeroed (subscription
 * credit lost) but currentPlanId is kept so the admin sees what to renew.
 * No auto-charge — payment integration is out of scope.
 *
 * Idempotent: re-running won't double-renew within the same window.
 */
export async function runDailySubscriptionRollover(): Promise<{ usersRenewed: number; usersLapsed: number; orgsRenewed: number; orgsLapsed: number }> {
  const now = new Date();

  // ── USERS ────────────────────────────────────────────────────────────────
  const expiredUsers = await db
    .select({
      id: usersTable.id,
      planId: usersTable.currentPlanId,
      planPrice: plansTable.priceUsd,
      planMonthlyCredits: plansTable.monthlyCredits,
    })
    .from(usersTable)
    .innerJoin(plansTable, eq(plansTable.id, usersTable.currentPlanId))
    .where(and(
      isNotNull(usersTable.currentPeriodEnd),
      lte(usersTable.currentPeriodEnd, now),
    ));

  let usersRenewed = 0;
  let usersLapsed = 0;
  for (const u of expiredUsers) {
    // Conditional update: only act if the period is still expired at write
    // time. Protects against races with concurrent admin extend/upgrade.
    if (u.planPrice === 0) {
      const updated = await db.update(usersTable).set({
        currentPeriodStartedAt: now,
        currentPeriodEnd: periodEndFromNow(),
        creditBalance: sql`${u.planMonthlyCredits}`,
      }).where(and(
        eq(usersTable.id, u.id),
        lte(usersTable.currentPeriodEnd, now),
      )).returning({ id: usersTable.id });
      if (updated.length > 0) usersRenewed++;
    } else {
      const updated = await db.update(usersTable).set({
        creditBalance: sql`0`,
      }).where(and(
        eq(usersTable.id, u.id),
        lte(usersTable.currentPeriodEnd, now),
      )).returning({ id: usersTable.id });
      if (updated.length > 0) usersLapsed++;
    }
  }

  // ── ORGS ─────────────────────────────────────────────────────────────────
  // Orgs don't carry a plan id; treat all expired orgs as "lapsed" — the
  // org's subscription credit is zeroed and admins/owners can top-up or
  // extend manually. (Auto-renew for orgs would require a plan link.)
  const expiredOrgs = await db
    .select({ id: organizationsTable.id })
    .from(organizationsTable)
    .where(and(
      isNotNull(organizationsTable.currentPeriodEnd),
      lte(organizationsTable.currentPeriodEnd, now),
      sql`${organizationsTable.creditBalance} > 0`,
    ));

  let orgsLapsed = 0;
  for (const o of expiredOrgs) {
    const updated = await db.update(organizationsTable).set({
      creditBalance: sql`0`,
    }).where(and(
      eq(organizationsTable.id, o.id),
      lte(organizationsTable.currentPeriodEnd, now),
    )).returning({ id: organizationsTable.id });
    if (updated.length > 0) orgsLapsed++;
  }

  if (usersRenewed || usersLapsed || orgsLapsed) {
    logger.info({ usersRenewed, usersLapsed, orgsRenewed: 0, orgsLapsed }, "Subscription rollover completed");
  }
  return { usersRenewed, usersLapsed, orgsRenewed: 0, orgsLapsed };
}

/** Schedule the daily rollover. Returns the timer handle for shutdown. */
export function startSubscriptionRolloverScheduler(): NodeJS.Timeout {
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  // Run once at startup (covers the case where the server was down across midnight)
  void runDailySubscriptionRollover().catch((err) => {
    logger.warn({ err }, "Subscription rollover (startup) failed");
  });
  return setInterval(() => {
    void runDailySubscriptionRollover().catch((err) => {
      logger.warn({ err }, "Subscription rollover (scheduled) failed");
    });
  }, ONE_DAY_MS);
}
