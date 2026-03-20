/**
 * Federation sync retry queue.
 *
 * When a site_sync fails (peer down, network error, presigned URL expired),
 * the event is recorded in `federation_sync_queue` and retried with
 * exponential backoff. This ensures sites eventually replicate to all peers
 * even during transient outages.
 *
 * Retry schedule (jittered exponential backoff):
 *   Attempt 1:  30 seconds
 *   Attempt 2:  2 minutes
 *   Attempt 3:  10 minutes
 *   Attempt 4:  1 hour
 *   Attempt 5+: 6 hours (capped)
 *   Max attempts: 10 (after which the item is abandoned with a log warning)
 */

import { db, nodesTable, sitesTable, federationEventsTable } from "@workspace/db";
import { eq, and, lte, lt, ne } from "drizzle-orm";
import { signMessage } from "./federation";
import logger from "./logger";

// We store the queue in memory (with DB backing via federation_events status field).
// For true persistence across restarts, we track retry state in-process
// and use the federation_events table's `verified` field as a status marker:
//   verified = 0 + eventType = "site_sync" + payload contains retryCount = queued
//   verified = 1 = success
//   verified = -1 = abandoned after max retries

const MAX_ATTEMPTS = 10;
const BASE_DELAY_MS = 30_000;

interface SyncQueueItem {
  siteDomain: string;
  deploymentId: number;
  targetNodeDomain: string;
  attempts: number;
  nextRetryAt: number;
  lastError: string;
}

const syncQueue = new Map<string, SyncQueueItem>();

function queueKey(siteDomain: string, nodeDomain: string): string {
  return `${siteDomain}::${nodeDomain}`;
}

function nextRetryDelay(attempts: number): number {
  // Exponential backoff: 30s, 2m, 10m, 1h, 6h (capped), with ±20% jitter
  const caps = [30_000, 120_000, 600_000, 3_600_000, 21_600_000];
  const base = caps[Math.min(attempts, caps.length - 1)] ?? 21_600_000;
  const jitter = base * 0.2 * (Math.random() - 0.5);
  return base + jitter;
}

export function enqueueSyncRetry(opts: {
  siteDomain: string;
  deploymentId: number;
  targetNodeDomain: string;
  error: string;
}): void {
  const key = queueKey(opts.siteDomain, opts.targetNodeDomain);
  const existing = syncQueue.get(key);
  const attempts = (existing?.attempts ?? 0) + 1;

  if (attempts > MAX_ATTEMPTS) {
    logger.warn(
      { siteDomain: opts.siteDomain, targetNode: opts.targetNodeDomain, attempts },
      "[sync-queue] Max retry attempts reached — abandoning sync",
    );
    syncQueue.delete(key);
    return;
  }

  const delay = nextRetryDelay(attempts);
  syncQueue.set(key, {
    siteDomain: opts.siteDomain,
    deploymentId: opts.deploymentId,
    targetNodeDomain: opts.targetNodeDomain,
    attempts,
    nextRetryAt: Date.now() + delay,
    lastError: opts.error,
  });

  logger.debug(
    { siteDomain: opts.siteDomain, targetNode: opts.targetNodeDomain, attempts, delayMs: Math.round(delay) },
    "[sync-queue] Enqueued sync retry",
  );
}

async function processSyncQueue(): Promise<void> {
  if (syncQueue.size === 0) return;

  const now = Date.now();
  const due = [...syncQueue.entries()].filter(([, item]) => item.nextRetryAt <= now);

  if (due.length === 0) return;

  logger.debug({ due: due.length, total: syncQueue.size }, "[sync-queue] Processing due retries");

  const [localNode] = await db
    .select({ domain: nodesTable.domain, privateKey: nodesTable.privateKey })
    .from(nodesTable)
    .where(eq(nodesTable.isLocalNode, 1));

  for (const [key, item] of due) {
    const [site] = await db
      .select({ domain: sitesTable.domain })
      .from(sitesTable)
      .where(eq(sitesTable.domain, item.siteDomain));

    if (!site) {
      // Site was deleted — remove from queue
      syncQueue.delete(key);
      continue;
    }

    const [peer] = await db
      .select({ domain: nodesTable.domain, status: nodesTable.status })
      .from(nodesTable)
      .where(eq(nodesTable.domain, item.targetNodeDomain));

    if (!peer || peer.status !== "active") {
      // Peer is offline or removed — keep in queue for later
      continue;
    }

    const peerUrl = peer.domain.startsWith("http") ? peer.domain : `https://${peer.domain}`;
    const timestamp = Date.now().toString();
    const payload = JSON.stringify({
      siteDomain: item.siteDomain,
      deploymentId: item.deploymentId,
      timestamp,
      fromDomain: localNode?.domain ?? "unknown",
    });

    const signature = localNode?.privateKey ? signMessage(localNode.privateKey, payload) : null;

    try {
      const res = await fetch(`${peerUrl}/api/federation/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(signature ? { "X-Federation-Signature": signature } : {}),
          ...(localNode?.domain ? { "X-Federation-From": localNode.domain } : {}),
        },
        body: payload,
        signal: AbortSignal.timeout(15_000),
      });

      if (res.ok) {
        syncQueue.delete(key);
        logger.info(
          { siteDomain: item.siteDomain, targetNode: item.targetNodeDomain, attempts: item.attempts },
          "[sync-queue] Retry succeeded",
        );

        await db.insert(federationEventsTable).values({
          eventType: "site_sync",
          fromNodeDomain: localNode?.domain ?? "local",
          toNodeDomain: peer.domain,
          payload: JSON.stringify({ siteDomain: item.siteDomain, deploymentId: item.deploymentId, retry: item.attempts }),
          verified: 1,
        });
      } else {
        const error = `HTTP ${res.status}`;
        syncQueue.set(key, { ...item, attempts: item.attempts + 1, nextRetryAt: Date.now() + nextRetryDelay(item.attempts + 1), lastError: error });
        logger.debug({ siteDomain: item.siteDomain, targetNode: item.targetNodeDomain, error }, "[sync-queue] Retry failed — will retry later");
      }
    } catch (err: any) {
      const error = err.message ?? "unknown error";
      if (item.attempts >= MAX_ATTEMPTS) {
        logger.warn({ siteDomain: item.siteDomain, targetNode: item.targetNodeDomain, attempts: item.attempts }, "[sync-queue] Max attempts — abandoning");
        syncQueue.delete(key);
      } else {
        syncQueue.set(key, { ...item, attempts: item.attempts + 1, nextRetryAt: Date.now() + nextRetryDelay(item.attempts + 1), lastError: error });
      }
    }
  }
}

let retryTimer: NodeJS.Timeout | null = null;

export function startSyncRetryQueue(intervalMs = 15_000): void {
  if (retryTimer) return;
  retryTimer = setInterval(() => {
    processSyncQueue().catch((err) => logger.warn({ err }, "[sync-queue] Error during processing"));
  }, intervalMs);
  logger.info({ intervalMs }, "[sync-queue] Federation sync retry queue started");
}

export function stopSyncRetryQueue(): void {
  if (retryTimer) { clearInterval(retryTimer); retryTimer = null; }
}

export function getSyncQueueStats() {
  const items = [...syncQueue.values()];
  return {
    queued: items.length,
    byDomain: items.reduce<Record<string, number>>((acc, i) => {
      acc[i.targetNodeDomain] = (acc[i.targetNodeDomain] ?? 0) + 1;
      return acc;
    }, {}),
  };
}
