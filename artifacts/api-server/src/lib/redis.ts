/**
 * Redis client singleton.
 *
 * Used by:
 *   - Rate limiter store (express-rate-limit + rate-limit-redis)
 *   - Future: session store for multi-instance deployments
 *   - Future: pub/sub for cache invalidation signals
 *
 * Connection is optional — if REDIS_URL is not set, the app runs in
 * single-instance mode with in-memory rate limiting. A warning is logged.
 *
 * In production with multiple API server instances, REDIS_URL MUST be set
 * or rate limiting will be bypassed (each instance has its own counter).
 */

import { Redis } from "ioredis";
import logger from "./logger";

let redisClient: Redis | null = null;

export function getRedisClient(): Redis | null {
  if (redisClient) return redisClient;

  const url = process.env.REDIS_URL;
  if (!url) {
    return null;
  }

  try {
    redisClient = new Redis(url, {
      maxRetriesPerRequest: 3,
      connectTimeout: 5_000,
      lazyConnect: true,
      enableReadyCheck: true,
    });

    redisClient.on("connect", () => {
      logger.info("[redis] Connected");
    });

    redisClient.on("error", (err) => {
      logger.warn({ err: err.message }, "[redis] Connection error");
    });

    redisClient.on("close", () => {
      logger.warn("[redis] Connection closed");
    });

    return redisClient;
  } catch (err) {
    logger.error({ err }, "[redis] Failed to create client");
    return null;
  }
}

export async function closeRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}
