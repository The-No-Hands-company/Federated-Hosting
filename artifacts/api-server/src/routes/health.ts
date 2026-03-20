import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { asyncHandler } from "../lib/errors";
import { getRedisClient } from "../lib/redis";
import { getCacheStats } from "../lib/domainCache";
import { getSyncQueueStats } from "../lib/syncRetryQueue";

const router: IRouter = Router();
const startTime = Date.now();

router.get("/health", asyncHandler(async (_req: Request, res: Response) => {
  const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);

  // Database check
  let dbStatus = "ok";
  let dbLatencyMs = 0;
  try {
    const t = Date.now();
    await db.execute(sql`SELECT 1`);
    dbLatencyMs = Date.now() - t;
  } catch {
    dbStatus = "error";
  }

  // Redis check
  const redis = getRedisClient();
  let redisStatus = redis ? "unchecked" : "not_configured";
  let redisLatencyMs: number | null = null;
  if (redis) {
    try {
      const t = Date.now();
      await redis.ping();
      redisLatencyMs = Date.now() - t;
      redisStatus = "ok";
    } catch {
      redisStatus = "error";
    }
  }

  const status = dbStatus === "ok" ? "healthy" : "degraded";

  res.status(status === "healthy" ? 200 : 503).json({
    status,
    uptime: uptimeSeconds,
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version ?? "0.0.0",
    environment: process.env.NODE_ENV ?? "development",
    services: {
      database:  { status: dbStatus, latencyMs: dbLatencyMs },
      redis:     { status: redisStatus, latencyMs: redisLatencyMs },
    },
    cache:     getCacheStats(),
    syncQueue: getSyncQueueStats(),
  });
}));

// Liveness probe — just confirm the process is alive
router.get("/health/live", (_req: Request, res: Response) => {
  res.status(200).json({ status: "alive", uptime: Math.floor((Date.now() - startTime) / 1000) });
});

// Readiness probe — only pass if DB is reachable
router.get("/health/ready", asyncHandler(async (_req: Request, res: Response) => {
  await db.execute(sql`SELECT 1`);
  res.status(200).json({ status: "ready" });
}));

export default router;
