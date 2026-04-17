import { getRedisClient } from "./redisClient";

/**
 * Redis-backed Token Bucket rate limiter.
 *
 * Uses a Lua script executed atomically to:
 * 1. Load the current bucket state
 * 2. Refill tokens based on elapsed time
 * 3. Consume one token if available
 * 4. Persist the new state with TTL
 *
 * Falls through to return null if Redis is unavailable,
 * letting the caller fall back to the DB implementation.
 */

const TOKEN_BUCKET_SCRIPT = `
local key = KEYS[1]
local rpm = tonumber(ARGV[1])
local now = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])

local data = redis.call('HMGET', key, 'tokens', 'last_refill')
local tokens = tonumber(data[1])
local last_refill = tonumber(data[2])

if tokens == nil then
  -- First request: create bucket with (rpm - 1) tokens
  redis.call('HMSET', key, 'tokens', rpm - 1, 'last_refill', now)
  redis.call('EXPIRE', key, ttl)
  return 1
end

-- Refill based on elapsed time
local elapsed_minutes = (now - last_refill) / 60000
local refilled = math.min(rpm, tokens + elapsed_minutes * rpm)

if refilled < 1 then
  -- Not enough tokens: update without consuming
  redis.call('HMSET', key, 'tokens', refilled, 'last_refill', now)
  redis.call('EXPIRE', key, ttl)
  return 0
end

-- Consume one token
redis.call('HMSET', key, 'tokens', refilled - 1, 'last_refill', now)
redis.call('EXPIRE', key, ttl)
return 1
`;

export async function checkRateLimitRedis(
  userId: number,
  rpm: number,
  endpointGroup: string = "all",
): Promise<boolean | null> {
  const redis = getRedisClient();
  if (!redis || redis.status !== "ready") return null;

  try {
    const key = `rl:user:${userId}:${endpointGroup}`;
    const now = Date.now();
    const ttlSeconds = Math.ceil((60 / rpm) * 2 * 60);

    const result = await redis.eval(
      TOKEN_BUCKET_SCRIPT,
      1,
      key,
      rpm.toString(),
      now.toString(),
      ttlSeconds.toString(),
    );

    return result === 1;
  } catch {
    return null;
  }
}

export async function clearBucketRedis(userId: number): Promise<void> {
  const redis = getRedisClient();
  if (!redis || redis.status !== "ready") return;

  try {
    // Delete all groups for this user using a SCAN+DEL pattern
    const pattern = `rl:user:${userId}:*`;
    const keys = await redis.keys(pattern);
    if (keys.length > 0) await redis.del(...keys);
    // Also delete legacy key without group suffix (back-compat)
    await redis.del(`rl:user:${userId}`);
  } catch {
    // ignore
  }
}
