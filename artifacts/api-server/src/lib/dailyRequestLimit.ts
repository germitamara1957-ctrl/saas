import { sql } from "drizzle-orm";
import { db, usageLogsTable, apiKeysTable } from "@workspace/db";
import { getRedisClient } from "./redisClient";

/**
 * Per-user daily request count limiter.
 *
 * `rpd = 0` means unlimited (default).
 *
 * Returns:
 *   - { allowed: true,  used, limit } when within limit (counter incremented)
 *   - { allowed: false, used, limit } when limit reached (counter NOT incremented)
 *
 * Counts reset at 00:00 UTC. Redis is the source of truth (with 26h TTL);
 * if Redis is unavailable, falls back to counting today's usage_logs rows.
 */
export interface DailyLimitResult {
  allowed: boolean;
  used: number;
  limit: number;
}

function todayKeyUTC(userId: number): string {
  const d = new Date();
  const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  return `rpd:user:${userId}:${ymd}`;
}

function startOfTodayUTC(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export async function checkDailyRequestLimit(userId: number, rpd: number): Promise<DailyLimitResult> {
  if (!rpd || rpd <= 0) {
    return { allowed: true, used: 0, limit: 0 };
  }

  const redis = getRedisClient();
  if (redis && redis.status === "ready") {
    try {
      const key = todayKeyUTC(userId);
      // Atomically increment then check; if over, decrement back.
      const used = await redis.incr(key);
      if (used === 1) {
        await redis.expire(key, 26 * 60 * 60); // 26h TTL covers DST/clock drift
      }
      if (used > rpd) {
        await redis.decr(key);
        return { allowed: false, used: used - 1, limit: rpd };
      }
      return { allowed: true, used, limit: rpd };
    } catch {
      // fall through to DB
    }
  }

  // DB fallback: count today's log rows for this user (joined via api_keys).
  const since = startOfTodayUTC();
  const [row] = await db
    .select({ total: sql<string>`COUNT(*)` })
    .from(usageLogsTable)
    .innerJoin(apiKeysTable, sql`${apiKeysTable.id} = ${usageLogsTable.apiKeyId}`)
    .where(sql`${apiKeysTable.userId} = ${userId} AND ${usageLogsTable.createdAt} >= ${since}`);
  const used = Number(row?.total ?? 0);
  if (used >= rpd) {
    return { allowed: false, used, limit: rpd };
  }
  return { allowed: true, used: used + 1, limit: rpd };
}
