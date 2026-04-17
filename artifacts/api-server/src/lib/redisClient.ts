import Redis from "ioredis";
import { logger } from "./logger";

let redisClient: Redis | null = null;
let connectionAttempted = false;

export function getRedisClient(): Redis | null {
  if (connectionAttempted) return redisClient;
  connectionAttempted = true;

  const url = process.env.REDIS_URL;
  if (!url) {
    logger.info("REDIS_URL not set — using PostgreSQL for rate limiting (Redis disabled)");
    return null;
  }

  try {
    const client = new Redis(url, {
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
      lazyConnect: false,
      connectTimeout: 5000,
      commandTimeout: 2000,
    });

    client.on("ready", () => {
      logger.info("Redis connected — using Redis for rate limiting");
      redisClient = client;
    });

    client.on("error", (err) => {
      logger.warn({ err }, "Redis error — rate limiting will fallback to PostgreSQL");
      redisClient = null;
    });

    client.on("close", () => {
      logger.warn("Redis connection closed — rate limiting fallback to PostgreSQL");
      redisClient = null;
    });

    redisClient = client;
    return client;
  } catch (err) {
    logger.warn({ err }, "Failed to create Redis client — falling back to PostgreSQL");
    return null;
  }
}

export function isRedisAvailable(): boolean {
  const client = getRedisClient();
  return client !== null && client.status === "ready";
}
