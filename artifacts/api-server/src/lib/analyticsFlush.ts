/**
 * Analytics flush job.
 *
 * Every 60 seconds, drains `analytics_buffer` into `site_analytics` hourly
 * rollups.  Uses a single DB transaction per flush cycle so we never lose
 * in-flight data if the server crashes mid-flush.
 */

import { db, siteAnalyticsTable, analyticsBufferTable } from "@workspace/db";
import { lt, sql, eq, and, inArray } from "drizzle-orm";
import logger from "./logger";
import type { broadcastAnalyticsHit as BroadcastFn } from "../routes/analytics";

// Lazy-loaded to avoid circular import at startup
let _broadcast: typeof BroadcastFn | null = null;
async function getBroadcast() {
  if (!_broadcast) {
    const mod = await import("../routes/analytics");
    _broadcast = mod.broadcastAnalyticsHit;
  }
  return _broadcast;
}
import crypto from "crypto";

const FLUSH_INTERVAL_MS = 60_000; // 1 minute

/** Truncate a Date to the start of its UTC hour. */
function toHour(d: Date): Date {
  const h = new Date(d);
  h.setUTCMinutes(0, 0, 0);
  return h;
}

/** Hash an IP for privacy — stored as a short hex digest, never raw IP. */
export function hashIp(ip: string): string {
  return crypto.createHash("sha256").update(ip).digest("hex").slice(0, 16);
}

export async function flushAnalyticsBuffer(): Promise<void> {
  const cutoff = new Date(Date.now() - 5_000); // don't flush rows written in last 5s

  const rows = await db
    .select()
    .from(analyticsBufferTable)
    .where(lt(analyticsBufferTable.recordedAt, cutoff))
    .limit(5000);

  if (rows.length === 0) return;

  // Group by (siteId, hour)
  type HourKey = string;
  interface HourBucket {
    siteId: number;
    hour: Date;
    hits: number;
    bytesServed: number;
    ips: Set<string>;
    referrers: Map<string, number>;
    paths: Map<string, number>;
  }

  const buckets = new Map<HourKey, HourBucket>();

  for (const row of rows) {
    const hour = toHour(row.recordedAt);
    const key: HourKey = `${row.siteId}:${hour.toISOString()}`;

    if (!buckets.has(key)) {
      buckets.set(key, {
        siteId: row.siteId,
        hour,
        hits: 0,
        bytesServed: 0,
        ips: new Set(),
        referrers: new Map(),
        paths: new Map(),
      });
    }

    const b = buckets.get(key)!;
    b.hits++;
    b.bytesServed += row.bytesServed ?? 0;
    if (row.ipHash) b.ips.add(row.ipHash);
    if (row.referrer) b.referrers.set(row.referrer, (b.referrers.get(row.referrer) ?? 0) + 1);
    if (row.path) b.paths.set(row.path, (b.paths.get(row.path) ?? 0) + 1);
  }

  const idsToDelete = rows.map((r) => r.id);

  await db.transaction(async (tx) => {
    for (const b of buckets.values()) {
      const topReferrers = JSON.stringify(
        [...b.referrers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
          .map(([referrer, count]) => ({ referrer, count })),
      );
      const topPaths = JSON.stringify(
        [...b.paths.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
          .map(([path, count]) => ({ path, count })),
      );

      await tx
        .insert(siteAnalyticsTable)
        .values({
          siteId: b.siteId,
          hour: b.hour,
          hits: b.hits,
          bytesServed: b.bytesServed,
          uniqueIps: b.ips.size,
          topReferrers,
          topPaths,
        })
        .onConflictDoUpdate({
          target: [siteAnalyticsTable.siteId, siteAnalyticsTable.hour],
          set: {
            hits: sql`${siteAnalyticsTable.hits} + EXCLUDED.hits`,
            bytesServed: sql`${siteAnalyticsTable.bytesServed} + EXCLUDED.bytes_served`,
            uniqueIps: sql`GREATEST(${siteAnalyticsTable.uniqueIps}, EXCLUDED.unique_ips)`,
            topReferrers: sql`EXCLUDED.top_referrers`,
            topPaths: sql`EXCLUDED.top_paths`,
            updatedAt: sql`now()`,
          },
        });
    }

    // Bulk delete flushed rows using inArray (safe, no SQL injection risk)
    if (idsToDelete.length > 0) {
      await tx.delete(analyticsBufferTable)
        .where(inArray(analyticsBufferTable.id, idsToDelete));
    }
  });

  logger.debug({ flushed: rows.length, buckets: buckets.size }, "Analytics buffer flushed");

  // ── Update per-site bandwidth + hit totals ────────────────────────────────
  // Roll up bytesServed into sites.monthly_bandwidth_gb for the usage dashboard.
  // We use a monthly window: reset on the 1st of each month by tracking via
  // the current month's analytics rows rather than a running counter.
  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    await db.execute(sql`
      UPDATE sites s
      SET
        monthly_bandwidth_gb = (
          SELECT COALESCE(SUM(bytes_served), 0) / (1024.0 * 1024 * 1024)
          FROM site_analytics
          WHERE site_id = s.id AND hour >= ${monthStart}
        ),
        hit_count = (
          SELECT COALESCE(SUM(hits), 0)
          FROM site_analytics
          WHERE site_id = s.id
        )
      WHERE s.id IN (
        SELECT DISTINCT site_id FROM site_analytics WHERE hour >= ${monthStart}
      )
    `);
  } catch (err) {
    logger.warn({ err }, "Failed to update site bandwidth/hit totals");
  }
}

let flushTimer: NodeJS.Timeout | null = null;

export function startAnalyticsFlusher(): void {
  if (flushTimer) return;
  logger.info("Analytics flusher started (60s interval)");

  const run = async () => {
    try {
      await flushAnalyticsBuffer();
    } catch (err) {
      logger.error({ err }, "Analytics flush error");
    }
  };

  flushTimer = setInterval(run, FLUSH_INTERVAL_MS);
  // Run immediately on startup
  run();
}

export function stopAnalyticsFlusher(): void {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
}
