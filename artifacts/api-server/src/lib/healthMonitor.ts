import { db, nodesTable, federationEventsTable } from "@workspace/db";
import { eq, ne } from "drizzle-orm";
import logger from "./logger";
// deliverWebhook is the real API. webhookNodeOffline/webhookNodeOnline were
// imported here and never existed in webhooks.ts — this module would have
// thrown on import had anything imported it, and nothing does. "node_online"
// and "node_offline" are already valid WebhookEventType values, so the events
// this file wanted to send were always supported; only these two wrappers were
// imaginary.
import { deliverWebhook } from "./webhooks";

const HEALTH_CHECK_INTERVAL_MS = 2 * 60 * 1000; // every 2 minutes
const REQUEST_TIMEOUT_MS = 8_000;
// Require 3 consecutive failures before marking a node offline.
// Transient network issues (DNS hiccup, brief connectivity) are normal in a global network.
const CONSECUTIVE_FAILURES_THRESHOLD = 3;

// In-memory failure counter per node domain — resets to 0 on success.
// In a multi-instance deployment, move this to Redis.
const failureCount = new Map<string, number>();

async function checkNode(
  nodeId: number,
  domain: string,
  currentStatus: string,
): Promise<void> {
  const url = `https://${domain}/.well-known/federation`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    // Reset failure count on success
    failureCount.delete(domain);

    await db
      .update(nodesTable)
      .set({ status: "active", lastSeenAt: new Date() })
      .where(eq(nodesTable.id, nodeId));

    if (currentStatus !== "active") {
      logger.info({ nodeId, domain }, "[health] Node back online");
      void deliverWebhook({ event: "node_online", nodeDomain: domain, timestamp: new Date().toISOString() });
    }
  } catch (err: any) {
    const failures = (failureCount.get(domain) ?? 0) + 1;
    failureCount.set(domain, failures);

    logger.debug({ nodeId, domain, failures, threshold: CONSECUTIVE_FAILURES_THRESHOLD }, "[health] Node check failed");

    if (failures >= CONSECUTIVE_FAILURES_THRESHOLD && currentStatus === "active") {
      await db
        .update(nodesTable)
        .set({ status: "inactive" })
        .where(eq(nodesTable.id, nodeId));

      await db.insert(federationEventsTable).values({
        eventType: "node_offline",
        fromNodeDomain: domain,
        toNodeDomain: null,
        payload: JSON.stringify({ reason: err.message, consecutiveFailures: failures }),
        verified: 0,
      });

      logger.info({ nodeId, domain, error: err.message, failures }, "[health] Node went offline after consecutive failures");
      void deliverWebhook({ event: "node_offline", nodeDomain: domain, timestamp: new Date().toISOString() });
      failureCount.delete(domain);
    } else if (failures < CONSECUTIVE_FAILURES_THRESHOLD) {
      logger.debug({ nodeId, domain, failures }, "[health] Node unreachable — waiting for threshold");
    }
  }
}

export async function runHealthCheck(): Promise<void> {
  try {
    const peers = await db
      .select({
        id: nodesTable.id,
        domain: nodesTable.domain,
        status: nodesTable.status,
      })
      .from(nodesTable)
      .where(ne(nodesTable.isLocalNode, 1));

    if (peers.length === 0) return;

    await Promise.allSettled(
      peers.map((p) => checkNode(p.id, p.domain, p.status)),
    );

    logger.info({ checked: peers.length }, "[health] Health check round complete");
  } catch (err) {
    logger.error({ err }, "[health] Health check failed");
  }
}

export function startHealthMonitor(): void {
  // Wait 30 s after startup before the first check
  setTimeout(() => {
    runHealthCheck();
    setInterval(runHealthCheck, HEALTH_CHECK_INTERVAL_MS);
  }, 30_000);

  logger.info(
    { intervalMs: HEALTH_CHECK_INTERVAL_MS },
    "[health] Health monitor started",
  );
}
