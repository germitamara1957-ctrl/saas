import { eq, sql, and } from "drizzle-orm";
import { db, rateLimitBucketsTable, type DbTransaction } from "@workspace/db";
import { checkRateLimitRedis, clearBucketRedis } from "./rateLimitRedis";

/**
 * Hybrid Token Bucket rate limiter — per (user, endpoint-group).
 *
 * Priority:
 *   1. Redis (if REDIS_URL is set and connection is ready)
 *   2. PostgreSQL (fallback)
 *
 * `bucketId` semantics:
 *   - positive value = userId (account-wide bucket)
 *   - negative value = -apiKeyId (per-key override bucket)
 *
 * `endpointGroup` separates buckets so that, e.g., heavy chat traffic does
 * not consume the video budget. Defaults to "all" for backward compatibility.
 */
export async function checkRateLimit(
  bucketId: number,
  rpm: number,
  endpointGroup: string = "all",
): Promise<boolean> {
  const userId = bucketId;

  // Try Redis first
  const redisResult = await checkRateLimitRedis(userId, rpm, endpointGroup);
  if (redisResult !== null) {
    return redisResult;
  }

  // Fallback to PostgreSQL token bucket
  return db.transaction(async (tx: DbTransaction) => {
    const [existing] = await tx
      .select()
      .from(rateLimitBucketsTable)
      .where(and(
        eq(rateLimitBucketsTable.userId, userId),
        eq(rateLimitBucketsTable.endpointGroup, endpointGroup),
      ))
      .limit(1)
      .for("update");

    const now = new Date();

    if (!existing) {
      await tx
        .insert(rateLimitBucketsTable)
        .values({ userId, endpointGroup, tokens: rpm - 1, lastRefillAt: now })
        .onConflictDoUpdate({
          target: [rateLimitBucketsTable.userId, rateLimitBucketsTable.endpointGroup],
          set: { tokens: sql`GREATEST(${rateLimitBucketsTable.tokens} - 1, 0)`, lastRefillAt: now },
        });
      return true;
    }

    const elapsedMinutes = (now.getTime() - existing.lastRefillAt.getTime()) / 60_000;
    const refilled = Math.min(rpm, existing.tokens + elapsedMinutes * rpm);

    if (refilled < 1) {
      await tx
        .update(rateLimitBucketsTable)
        .set({ tokens: refilled })
        .where(and(
          eq(rateLimitBucketsTable.userId, userId),
          eq(rateLimitBucketsTable.endpointGroup, endpointGroup),
        ));
      return false;
    }

    await tx
      .update(rateLimitBucketsTable)
      .set({ tokens: refilled - 1, lastRefillAt: now })
      .where(and(
        eq(rateLimitBucketsTable.userId, userId),
        eq(rateLimitBucketsTable.endpointGroup, endpointGroup),
      ));

    return true;
  });
}

export async function clearBucket(userId: number): Promise<void> {
  await Promise.allSettled([
    clearBucketRedis(userId),
    db.delete(rateLimitBucketsTable).where(eq(rateLimitBucketsTable.userId, userId)),
  ]);
}
