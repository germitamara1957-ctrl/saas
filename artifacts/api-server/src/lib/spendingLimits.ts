import { db, usersTable, usageLogsTable, apiKeysTable, organizationsTable } from "@workspace/db";
import { eq, and, gte, sql, inArray, isNull } from "drizzle-orm";
import { sendEmail } from "./email";
import { logger } from "./logger";
import { dispatchWebhooks } from "./webhookDispatcher";

export type SpendingCheck = {
  allowed: boolean;
  dailySpent: number;
  monthlySpent: number;
  dailyLimit: number | null;
  monthlyLimit: number | null;
  reason?: string;
};

function startOfUtcDay(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function startOfUtcMonth(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/**
 * Check whether the user is within their daily/monthly spend limits.
 * Sums `cost_usd` from `usage_logs` where status='success' and the log
 * belongs to one of the user's API keys.
 *
 * Side-effects (best effort, non-blocking):
 *  - If spend crosses `spendAlertThreshold` of either limit, send one email
 *    per 24h ("alert") + fire `spending.alert` webhook.
 *  - If a hard limit is hit, fire `spending.limit_reached` webhook.
 */
export async function checkSpendingLimits(userId: number): Promise<SpendingCheck> {
  const [user] = await db
    .select({
      dailyLimit: usersTable.dailySpendLimitUsd,
      monthlyLimit: usersTable.monthlySpendLimitUsd,
      threshold: usersTable.spendAlertThreshold,
      lastAlertAt: usersTable.spendAlertEmailSentAt,
      email: usersTable.email,
      name: usersTable.name,
    })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (!user) {
    return { allowed: true, dailySpent: 0, monthlySpent: 0, dailyLimit: null, monthlyLimit: null };
  }

  if (user.dailyLimit == null && user.monthlyLimit == null) {
    return { allowed: true, dailySpent: 0, monthlySpent: 0, dailyLimit: null, monthlyLimit: null };
  }

  // Only count PERSONAL keys (organizationId IS NULL). Org-bound keys debit
  // the organization pool and must not contaminate the user's personal cap.
  const userKeys = await db
    .select({ id: apiKeysTable.id })
    .from(apiKeysTable)
    .where(and(eq(apiKeysTable.userId, userId), isNull(apiKeysTable.organizationId)));
  const keyIds = userKeys.map((k) => k.id);
  if (keyIds.length === 0) {
    return { allowed: true, dailySpent: 0, monthlySpent: 0, dailyLimit: user.dailyLimit, monthlyLimit: user.monthlyLimit };
  }

  const [daySum] = await db
    .select({ total: sql<string>`COALESCE(SUM(${usageLogsTable.costUsd}), 0)` })
    .from(usageLogsTable)
    .where(and(
      inArray(usageLogsTable.apiKeyId, keyIds),
      eq(usageLogsTable.status, "success"),
      gte(usageLogsTable.createdAt, startOfUtcDay()),
    ));
  const [monthSum] = await db
    .select({ total: sql<string>`COALESCE(SUM(${usageLogsTable.costUsd}), 0)` })
    .from(usageLogsTable)
    .where(and(
      inArray(usageLogsTable.apiKeyId, keyIds),
      eq(usageLogsTable.status, "success"),
      gte(usageLogsTable.createdAt, startOfUtcMonth()),
    ));

  const dailySpent = Number(daySum?.total ?? 0);
  const monthlySpent = Number(monthSum?.total ?? 0);

  const dailyExceeded = user.dailyLimit != null && dailySpent >= user.dailyLimit;
  const monthlyExceeded = user.monthlyLimit != null && monthlySpent >= user.monthlyLimit;

  if (dailyExceeded || monthlyExceeded) {
    // Fire hard-limit webhook (non-blocking)
    void dispatchWebhooks(userId, "spending.limit_reached", {
      dailySpent, monthlySpent,
      dailyLimit: user.dailyLimit, monthlyLimit: user.monthlyLimit,
      kind: dailyExceeded ? "daily" : "monthly",
    }).catch(() => {});

    return {
      allowed: false,
      dailySpent, monthlySpent,
      dailyLimit: user.dailyLimit, monthlyLimit: user.monthlyLimit,
      reason: dailyExceeded
        ? `Daily spend limit reached ($${dailySpent.toFixed(4)} of $${user.dailyLimit!.toFixed(2)}). Increase limit in dashboard or wait until 00:00 UTC.`
        : `Monthly spend limit reached ($${monthlySpent.toFixed(4)} of $${user.monthlyLimit!.toFixed(2)}). Increase limit in dashboard or wait until next month.`,
    };
  }

  // Threshold alert (e.g. 80%) — fire once per 24h
  const threshold = user.threshold ?? 0.8;
  const dailyFrac = user.dailyLimit ? dailySpent / user.dailyLimit : 0;
  const monthlyFrac = user.monthlyLimit ? monthlySpent / user.monthlyLimit : 0;
  const crossed = dailyFrac >= threshold || monthlyFrac >= threshold;

  if (crossed) {
    const cooldownMs = 24 * 60 * 60 * 1000;
    const last = user.lastAlertAt?.getTime() ?? 0;
    if (Date.now() - last > cooldownMs) {
      // Mark sent first to dedupe even if the email or webhook is slow.
      await db.update(usersTable)
        .set({ spendAlertEmailSentAt: new Date() })
        .where(eq(usersTable.id, userId));

      const which = dailyFrac >= threshold ? "daily" : "monthly";
      const pct = Math.round((which === "daily" ? dailyFrac : monthlyFrac) * 100);
      const limit = which === "daily" ? user.dailyLimit! : user.monthlyLimit!;
      const spent = which === "daily" ? dailySpent : monthlySpent;

      void sendEmail({
        to: user.email,
        subject: `[AI Gateway] You've used ${pct}% of your ${which} spend limit`,
        text: `Hi ${user.name},\n\nYou've spent $${spent.toFixed(4)} of your $${limit.toFixed(2)} ${which} limit (${pct}%).\n\nWhen you reach 100%, your API will pause until you raise the limit or the period resets.\n\nManage limits in your dashboard → Settings → Spending Limits.`,
        html: `<p>Hi ${user.name},</p><p>You've spent <b>$${spent.toFixed(4)}</b> of your <b>$${limit.toFixed(2)} ${which} limit</b> (<b>${pct}%</b>).</p><p>When you reach 100%, your API will pause until you raise the limit or the period resets.</p><p>Manage limits in your <a href="https://fullapikey.replit.app/portal/settings">dashboard → Settings → Spending Limits</a>.</p>`,
      }).catch((err) => {
        logger.warn({ err, userId }, "Failed to send spending alert email");
      });

      void dispatchWebhooks(userId, "spending.alert", {
        kind: which, percentage: pct, spent, limit,
        dailySpent, monthlySpent,
        dailyLimit: user.dailyLimit, monthlyLimit: user.monthlyLimit,
      }).catch(() => {});
    }
  }

  return {
    allowed: true,
    dailySpent, monthlySpent,
    dailyLimit: user.dailyLimit, monthlyLimit: user.monthlyLimit,
  };
}

/**
 * Org-pool variant of `checkSpendingLimits`. Sums `usage_logs.cost_usd` where
 * `organization_id = orgId` (regardless of which member's API key made the
 * call). No alert/email side-effects yet — caller may extend later.
 */
export async function checkOrgSpendingLimits(orgId: number): Promise<SpendingCheck> {
  const [org] = await db
    .select({
      dailyLimit: organizationsTable.dailySpendLimitUsd,
      monthlyLimit: organizationsTable.monthlySpendLimitUsd,
    })
    .from(organizationsTable)
    .where(eq(organizationsTable.id, orgId))
    .limit(1);

  if (!org) {
    return { allowed: true, dailySpent: 0, monthlySpent: 0, dailyLimit: null, monthlyLimit: null };
  }
  if (org.dailyLimit == null && org.monthlyLimit == null) {
    return { allowed: true, dailySpent: 0, monthlySpent: 0, dailyLimit: null, monthlyLimit: null };
  }

  const [daySum] = await db
    .select({ total: sql<string>`COALESCE(SUM(${usageLogsTable.costUsd}), 0)` })
    .from(usageLogsTable)
    .where(and(
      eq(usageLogsTable.organizationId, orgId),
      eq(usageLogsTable.status, "success"),
      gte(usageLogsTable.createdAt, startOfUtcDay()),
    ));
  const [monthSum] = await db
    .select({ total: sql<string>`COALESCE(SUM(${usageLogsTable.costUsd}), 0)` })
    .from(usageLogsTable)
    .where(and(
      eq(usageLogsTable.organizationId, orgId),
      eq(usageLogsTable.status, "success"),
      gte(usageLogsTable.createdAt, startOfUtcMonth()),
    ));

  const dailySpent = Number(daySum?.total ?? 0);
  const monthlySpent = Number(monthSum?.total ?? 0);

  const dailyExceeded = org.dailyLimit != null && dailySpent >= org.dailyLimit;
  const monthlyExceeded = org.monthlyLimit != null && monthlySpent >= org.monthlyLimit;

  if (dailyExceeded || monthlyExceeded) {
    return {
      allowed: false,
      dailySpent, monthlySpent,
      dailyLimit: org.dailyLimit, monthlyLimit: org.monthlyLimit,
      reason: dailyExceeded
        ? `Organization daily spend limit reached ($${dailySpent.toFixed(4)} of $${org.dailyLimit!.toFixed(2)}). Wait until 00:00 UTC or ask an owner/admin to raise the cap.`
        : `Organization monthly spend limit reached ($${monthlySpent.toFixed(4)} of $${org.monthlyLimit!.toFixed(2)}). Wait until next month or ask an owner/admin to raise the cap.`,
    };
  }

  return {
    allowed: true,
    dailySpent, monthlySpent,
    dailyLimit: org.dailyLimit, monthlyLimit: org.monthlyLimit,
  };
}
