import rateLimit from "express-rate-limit";
import slowDown from "express-slow-down";
import { getRedisClient } from "../lib/redis";
import logger from "../lib/logger";
import { GLOBAL_RATE_LIMIT, UPLOAD_RATE_LIMIT } from "../lib/resourceConfig";

const isProd = process.env.NODE_ENV === "production";

// Build optional Redis store for rate limiting.
// Without Redis, rate limits are per-instance (not shared across multiple API servers).
// With Redis, limits are enforced network-wide — required for horizontal scaling.
function makeStore() {
  const redis = getRedisClient();
  if (!redis) {
    if (isProd) {
      logger.warn(
        "[rate-limit] REDIS_URL not set — rate limiting is per-instance only. " +
        "In multi-instance deployments this is a security gap. Set REDIS_URL."
      );
    }
    return undefined; // express-rate-limit falls back to in-memory
  }

  // rate-limit-redis v4 uses sendCommand interface
  return {
    sendCommand: (...args: string[]) => redis.call(...args),
  } as import("rate-limit-redis").RedisStore;
}

const store = makeStore();

function makeHandler(message: string, code: string) {
  return (_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) => {
    res.status(429).json({ error: { message, code } });
  };
}

// Global limiter — 300 requests / minute per IP (60 in LOW_RESOURCE mode)
export const globalLimiter = rateLimit({
  windowMs: 60_000,
  max: isProd ? GLOBAL_RATE_LIMIT : 10_000,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  store,
  handler: makeHandler("Too many requests. Please slow down.", "RATE_LIMITED"),
  skip: (req) => req.path === "/api/health",
});

// Auth endpoints — 20 attempts / 15 minutes per IP
export const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: isProd ? 20 : 1_000,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  store,
  handler: makeHandler(
    "Too many authentication attempts. Try again in 15 minutes.",
    "AUTH_RATE_LIMITED",
  ),
});

// Upload endpoints — 60 uploads / minute per IP (10 in LOW_RESOURCE mode)
export const uploadLimiter = rateLimit({
  windowMs: 60_000,
  max: isProd ? UPLOAD_RATE_LIMIT : 1_000,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  store,
  handler: makeHandler("Upload limit reached. Please wait before uploading again.", "UPLOAD_RATE_LIMITED"),
});

// Federation handshake — 30 / minute per IP
export const federationLimiter = rateLimit({
  windowMs: 60_000,
  max: isProd ? 30 : 1_000,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  store,
  handler: makeHandler("Federation request limit reached.", "FEDERATION_RATE_LIMITED"),
});

// Write operations — 60 mutations / minute per IP (create, update, delete)
export const writeLimiter = rateLimit({
  windowMs: 60_000,
  max: isProd ? 60 : 10_000,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  store,
  handler: makeHandler("Write limit reached. Please wait before making more changes.", "WRITE_RATE_LIMITED"),
});

// Token creation — 10 / hour per IP (prevent token harvesting)
export const tokenLimiter = rateLimit({
  windowMs: 60 * 60_000,
  max: isProd ? 10 : 1_000,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  store,
  handler: makeHandler("Token creation limit reached. Try again in an hour.", "TOKEN_RATE_LIMITED"),
});

// Webhook test delivery — 20 / hour per IP
export const webhookLimiter = rateLimit({
  windowMs: 60 * 60_000,
  max: isProd ? 20 : 1_000,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  store,
  handler: makeHandler("Webhook test limit reached.", "WEBHOOK_RATE_LIMITED"),
});

// Per-user write limiter — keyed by user ID, not IP.
// Prevents a single authenticated user from hammering write endpoints
// even through rotating IPs or shared NAT.
// Applied ON TOP of the per-IP writeLimiter — both must pass.
export const userWriteLimiter = rateLimit({
  windowMs: 60_000,
  max: isProd ? 120 : 10_000,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  store,
  keyGenerator: (req) => {
    // Use authenticated user ID if available, fall back to IP
    const user = (req as any).user as { id?: string } | undefined;
    return user?.id ?? req.ip ?? "anonymous";
  },
  handler: makeHandler("Too many requests from this account. Please slow down.", "USER_RATE_LIMITED"),
  skip: (req) => !(req as any).user, // skip if not authenticated (IP limiter handles it)
});

// Per-user deploy limiter — max 20 deploys/hour per account
export const deployLimiter = rateLimit({
  windowMs: 60 * 60_000,
  max: isProd ? 20 : 1_000,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  store,
  keyGenerator: (req) => {
    const user = (req as any).user as { id?: string } | undefined;
    return `deploy:${user?.id ?? req.ip}`;
  },
  handler: makeHandler("Deploy limit reached (20 per hour). Please wait before deploying again.", "DEPLOY_RATE_LIMITED"),
});
  windowMs: 60_000,
  delayAfter: isProd ? 100 : 5_000,
  delayMs: (used, req) => {
    const delayAfter = (req as { slowDown?: { limit: number } }).slowDown?.limit ?? 100;
    return (used - delayAfter) * 50;
  },
});
