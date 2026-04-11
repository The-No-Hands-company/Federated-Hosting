import app from "./app";
import { db, nodesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { generateKeyPair } from "./lib/federation";
// ── Resource configuration — MUST be imported before anything that reads env vars ──
import {
  LOW_RESOURCE, DB_POOL, LOG_LEVEL,
  ANALYTICS_FLUSH_INTERVAL_MS, HEALTH_CHECK_INTERVAL_MS, GOSSIP_INTERVAL_MS,
} from "./lib/resourceConfig";

// Apply LOW_RESOURCE overrides to process.env NOW so all downstream modules
// (db pool, logger, caches, rate limiters) pick up constrained values at init time.
if (LOW_RESOURCE) {
  process.env.DB_POOL_MAX                 = String(DB_POOL.max);
  process.env.DB_POOL_MIN                 = String(DB_POOL.min);
  process.env.DB_IDLE_TIMEOUT_MS          = String(DB_POOL.idleTimeoutMillis);
  process.env.DB_CONNECT_TIMEOUT_MS       = String(DB_POOL.connectionTimeoutMillis);
  process.env.LOG_LEVEL                   = LOG_LEVEL;
  process.env.ANALYTICS_FLUSH_INTERVAL_MS = String(ANALYTICS_FLUSH_INTERVAL_MS);
  process.env.HEALTH_CHECK_INTERVAL_MS    = String(HEALTH_CHECK_INTERVAL_MS);
  process.env.GOSSIP_INTERVAL_MS          = String(GOSSIP_INTERVAL_MS);
  process.env.DOMAIN_CACHE_MAX            = process.env.DOMAIN_CACHE_MAX ?? "500";
  process.env.FILE_CACHE_MAX              = process.env.FILE_CACHE_MAX   ?? "2000";
}
import { startAnalyticsFlusher, stopAnalyticsFlusher } from "./lib/analyticsFlush";
import { startGossipPusher, stopGossipPusher } from "./routes/gossip";
import { getRedisClient, closeRedis } from "./lib/redis";
import { startSyncRetryQueue, stopSyncRetryQueue } from "./lib/syncRetryQueue";
import { loadBlocklist } from "./routes/federationBlocks";
import { startAcmeRenewalScheduler, stopAcmeRenewalScheduler } from "./lib/acme";
import { stopAllProcesses } from "./lib/processManager";
import { startSiteHealthMonitor, stopSiteHealthMonitor } from "./lib/siteHealthMonitor";
import { startMetricsCollector, stopMetricsCollector } from "./lib/metricsCollector";
import { startWebhookRetryProcessor, stopWebhookRetryProcessor } from "./lib/webhooks";
import { startRetentionJob, stopRetentionJob } from "./lib/retentionCleanup";
import { startEmailQueue, stopEmailQueue } from "./lib/email";
import { startOrphanCleanup, stopOrphanCleanup } from "./lib/orphanCleanup";
import { runBootstrapSeed } from "./lib/bootstrapSeed";
import { ensureBucketExists } from "./lib/storageInit";
import { registerToolWithCloud, sendToolHeartbeat } from "./lib/nexusCloudClient";
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
      stopSiteHealthMonitor();
      stopMetricsCollector();
      stopWebhookRetryProcessor();
      stopRetentionJob();
      stopEmailQueue();
      stopOrphanCleanup();
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
    await loadBlocklist();
    startAnalyticsFlusher();

    // Ensure S3 bucket exists (creates it if missing — makes docker compose up work without manual MinIO setup)
    await ensureBucketExists();
    startGossipPusher();
    startSyncRetryQueue();
    startAcmeRenewalScheduler();
    startSiteHealthMonitor();
    startMetricsCollector();
    startWebhookRetryProcessor();
    startRetentionJob();
    startEmailQueue();
    startOrphanCleanup();

    // Seed federation peers from BOOTSTRAP_URLS (once, non-blocking)
    runBootstrapSeed().catch(err =>
      logger.warn({ err: err.message }, "[bootstrap] Seed failed — continuing without initial peers")
    );

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

    // Register with Nexus Cloud if configured (non-blocking, best-effort)
    const nexusCloudUrl = process.env["NEXUS_CLOUD_URL"];
    const nexusCloudApiKey = process.env["NEXUS_CLOUD_API_KEY"] ?? "";
    const publicUrl = process.env["PUBLIC_URL"] ?? `http://localhost:${port}`;
    if (nexusCloudUrl) {
      registerToolWithCloud(
        nexusCloudUrl,
        {
          id: "nexus-hosting",
          name: "Nexus Hosting",
          description: "Decentralised static site hosting network",
          upstreamUrl: publicUrl,
          mode: "standalone",
          exposed: true,
          health: "healthy",
          capabilities: ["hosting", "static-sites", "federation", "ssl", "custom-domains"],
        },
        nexusCloudApiKey,
      ).catch(err =>
        logger.warn({ err: err.message }, "[cloud] Registration with Nexus Cloud failed — continuing")
      );
      setInterval(() => {
        sendToolHeartbeat(nexusCloudUrl, "nexus-hosting", nexusCloudApiKey, publicUrl).catch(() => {});
      }, 30_000);
    }

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
