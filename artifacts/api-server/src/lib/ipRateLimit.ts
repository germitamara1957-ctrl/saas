import { db, ipRateLimitsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { withDbRetry } from "./dbRetry";

/**
 * DB-backed IP rate limiter.
 * Persists across server restarts and works correctly with multiple instances.
 * Uses upsert + conditional increment for atomicity without explicit transactions.
 */
async function check(
  key: string,
  maxAttempts: number,
  windowMs: number,
): Promise<{ allowed: boolean; retryAfterMs: number }> {
  const now = new Date();
  const resetAt = new Date(now.getTime() + windowMs);

  // Upsert: insert if not exists, or increment count if window still active
  // If the window has expired (resetAt < now), reset to a fresh window
  // Wrapped in withDbRetry: ON CONFLICT under heavy concurrency or transient
  // Neon disconnects can yield 40001/08006 errors that recover on retry.
  const [row] = await withDbRetry(
    () =>
      db
        .insert(ipRateLimitsTable)
        .values({ key, count: 1, resetAt })
        .onConflictDoUpdate({
          target: ipRateLimitsTable.key,
          set: {
            count: sql`CASE
              WHEN ${ipRateLimitsTable.resetAt} < NOW()
              THEN 1
              ELSE ${ipRateLimitsTable.count} + 1
            END`,
            resetAt: sql`CASE
              WHEN ${ipRateLimitsTable.resetAt} < NOW()
              THEN ${resetAt.toISOString()}::timestamptz
              ELSE ${ipRateLimitsTable.resetAt}
            END`,
          },
        })
        .returning(),
    { label: "ipRateLimit.check" },
  );

  if (!row) {
    return { allowed: true, retryAfterMs: 0 };
  }

  if (row.count > maxAttempts) {
    const retryAfterMs = Math.max(0, row.resetAt.getTime() - now.getTime());
    return { allowed: false, retryAfterMs };
  }

  return { allowed: true, retryAfterMs: 0 };
}

export async function checkRegistrationLimit(ip: string): Promise<{ allowed: boolean; retryAfterMs: number }> {
  return check(`reg:${ip}`, 5, 24 * 60 * 60 * 1000);
}

export async function checkLoginLimit(ip: string, email: string): Promise<{ allowed: boolean; retryAfterMs: number }> {
  const byIp = await check(`login_ip:${ip}`, 20, 15 * 60 * 1000);
  if (!byIp.allowed) return byIp;
  return check(`login_email:${email.toLowerCase()}`, 10, 15 * 60 * 1000);
}

export async function resetLoginLimit(ip: string, email: string): Promise<void> {
  await db.delete(ipRateLimitsTable).where(eq(ipRateLimitsTable.key, `login_ip:${ip}`));
  await db.delete(ipRateLimitsTable).where(eq(ipRateLimitsTable.key, `login_email:${email.toLowerCase()}`));
}

// Cleanup expired entries (call periodically e.g. from a cron or startup)
export async function cleanupExpiredIpLimits(): Promise<void> {
  await db.delete(ipRateLimitsTable).where(sql`${ipRateLimitsTable.resetAt} < NOW()`);
}
