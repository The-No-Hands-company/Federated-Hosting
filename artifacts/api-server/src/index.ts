import app from "./app";
import { db, nodesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { generateKeyPair } from "./lib/federation";
import { startHealthMonitor } from "./lib/healthMonitor";
import { startAnalyticsFlusher, stopAnalyticsFlusher } from "./lib/analyticsFlush";
import { startGossipPusher, stopGossipPusher } from "./routes/gossip";
import { getRedisClient, closeRedis } from "./lib/redis";
import { startSyncRetryQueue, stopSyncRetryQueue } from "./lib/syncRetryQueue";
import { startAcmeRenewalScheduler, stopAcmeRenewalScheduler } from "./lib/acme";
import { db, sessionsTable } from "@workspace/db";
import { lt } from "drizzle-orm";
import { seedBundledSites } from "./lib/seedBundledSites";
import logger from "./lib/logger";
import http from "http";

const rawPort = process.env["PORT"];
if (!rawPort) throw new Error("PORT environment variable is required but was not provided.");
const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) throw new Error(`Invalid PORT value: "${rawPort}"`);

async function ensureLocalNode(): Promise<void> {
  const [existing] = await db.select().from(nodesTable).where(eq(nodesTable.isLocalNode, 1));

  if (!existing) {
    const domain = process.env.PUBLIC_DOMAIN ?? `localhost:${port}`;
    const { publicKey, privateKey } = generateKeyPair();
    const [created] = await db
      .insert(nodesTable)
      .values({
        name: process.env.NODE_NAME ?? "Primary Node",
        domain,
        region: process.env.NODE_REGION ?? "unknown",
        operatorName: process.env.OPERATOR_NAME ?? "Node Operator",
        operatorEmail: process.env.OPERATOR_EMAIL ?? "admin@example.com",
        storageCapacityGb: Number(process.env.STORAGE_CAPACITY_GB ?? 100),
        bandwidthCapacityGb: Number(process.env.BANDWIDTH_CAPACITY_GB ?? 1000),
        publicKey,
        privateKey,
        isLocalNode: 1,
      })
      .returning();
    logger.info({ nodeId: created.id, domain: created.domain }, "[federation] Local node created");
  } else if (!existing.publicKey || !existing.privateKey) {
    const { publicKey, privateKey } = generateKeyPair();
    await db.update(nodesTable).set({ publicKey, privateKey }).where(eq(nodesTable.id, existing.id));
    logger.info({ nodeId: existing.id }, "[federation] Ed25519 key pair generated for local node");
  } else {
    logger.info({ nodeId: existing.id, domain: existing.domain }, "[federation] Local node ready");
  }
}

function gracefulShutdown(server: http.Server, signal: string): void {
  logger.info({ signal }, "Shutdown signal received — draining connections");

  const forceExitTimer = setTimeout(() => {
    logger.error("Force exit after timeout");
    process.exit(1);
  }, 15_000);
  forceExitTimer.unref();

  server.close(async () => {
    try {
      stopAnalyticsFlusher();
      stopGossipPusher();
      stopSyncRetryQueue();
      stopAcmeRenewalScheduler();
      await closeRedis();
      const { pool } = await import("@workspace/db");
      await pool.end();
      logger.info("Database pool closed");
    } catch (err) {
      logger.error({ err }, "Error closing DB pool");
    }
    clearTimeout(forceExitTimer);
    logger.info("Server shut down cleanly");
    process.exit(0);
  });
}

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled promise rejection");
});

process.on("uncaughtException", (err) => {
  logger.error({ err }, "Uncaught exception — shutting down");
  process.exit(1);
});

ensureLocalNode()
  .then(() => {
    const server = http.createServer(app);

    server.listen(port, () => {
      logger.info({ port, env: process.env.NODE_ENV ?? "development" }, "Server listening");
    });

    startHealthMonitor();
    startAnalyticsFlusher();
    startGossipPusher();
    startSyncRetryQueue();
    startAcmeRenewalScheduler();

    // Initialise Redis connection (optional — falls back to in-memory if not configured)
    const redis = getRedisClient();
    if (redis) {
      await redis.connect().catch(() => {}); // errors handled via 'error' event
    }

    // Session expiry cleanup — purge expired sessions every 6 hours
    // Prevents unbounded growth of the sessions table
    const cleanupSessions = async () => {
      try {
        const result = await db.delete(sessionsTable).where(lt(sessionsTable.expire, new Date()));
        logger.debug("[session-cleanup] Expired sessions purged");
      } catch (err) {
        logger.warn({ err }, "[session-cleanup] Error purging sessions");
      }
    };
    cleanupSessions(); // run once on startup
    setInterval(cleanupSessions, 6 * 60 * 60 * 1000); // then every 6 hours

    seedBundledSites();

    process.on("SIGTERM", () => gracefulShutdown(server, "SIGTERM"));
    process.on("SIGINT", () => gracefulShutdown(server, "SIGINT"));
  })
  .catch((err) => {
    logger.error({ err }, "Failed to initialize — starting without local node");
    const server = http.createServer(app);
    server.listen(port, () => {
      logger.info({ port }, "Server listening (degraded mode)");
    });
  });
