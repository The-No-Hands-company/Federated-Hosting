/**
 * Prometheus gauge collector.
 *
 * The HTTP metrics (requests_total, duration, active_requests) update
 * themselves via middleware. Business gauges need to be polled from the DB
 * because they represent state, not events.
 *
 * Runs every 30 seconds and updates:
 *   nexus_sites_total         — by status (active/inactive/suspended)
 *   nexus_federation_peers_total — by status (active/offline/pending)
 *   nexus_sync_queue_depth    — pending retry items
 *   nexus_cache_entries       — domain and file LRU cache size
 */

import { db, sitesTable, nodesTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  sitesTotal,
  federationPeersTotal,
  syncQueueDepth,
  cacheEntries,
  deploymentsTotal,
  storageOperationsTotal,
} from "./metrics";
import { getCacheStats } from "./domainCache";
import { getSyncQueueDepth } from "./syncRetryQueue";
import logger from "./logger";

const INTERVAL_MS = 30_000;
let timer: NodeJS.Timeout | null = null;

async function collect(): Promise<void> {
  try {
    // ── Sites by status ───────────────────────────────────────────────────
    const siteCounts = await db
      .select({ status: sitesTable.status, count: sql<number>`COUNT(*)` })
      .from(sitesTable)
      .groupBy(sitesTable.status);

    // Reset all labels first so removed statuses go to 0
    for (const status of ["active", "inactive", "suspended"]) {
      sitesTotal.set({ status }, 0);
    }
    for (const row of siteCounts) {
      sitesTotal.set({ status: row.status }, Number(row.count));
    }

    // ── Federation peers by status ────────────────────────────────────────
    const peerCounts = await db
      .select({ status: nodesTable.status, count: sql<number>`COUNT(*)` })
      .from(nodesTable)
      .groupBy(nodesTable.status);

    for (const status of ["active", "offline", "pending"]) {
      federationPeersTotal.set({ status }, 0);
    }
    for (const row of peerCounts) {
      federationPeersTotal.set({ status: row.status }, Number(row.count));
    }

    // ── Sync retry queue depth ────────────────────────────────────────────
    const queueDepth = getSyncQueueDepth();
    syncQueueDepth.set(queueDepth);

    // ── LRU cache sizes ───────────────────────────────────────────────────
    const stats = getCacheStats();
    cacheEntries.set({ cache_type: "domain" }, stats.domainEntries);
    cacheEntries.set({ cache_type: "file" },   stats.fileEntries);

  } catch (err) {
    logger.warn({ err }, "[metrics-collector] Collection failed");
  }
}

export function startMetricsCollector(): void {
  collect().catch(() => {});
  timer = setInterval(collect, INTERVAL_MS);
  logger.info({ intervalMs: INTERVAL_MS }, "[metrics-collector] Started");
}

export function stopMetricsCollector(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
