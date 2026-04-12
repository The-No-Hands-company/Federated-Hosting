/**
 * Data retention and cleanup job.
 *
 * Runs every 6 hours and enforces retention policies:
 *
 * analytics_buffer     — keep nothing (cleared after flush, handled separately)
 * site_analytics       — keep 90 days rolling (configurable via ANALYTICS_RETENTION_DAYS)
 * form_submissions     — keep 365 days unless FORM_RETENTION_DAYS is set
 * webhook_deliveries   — keep 30 days
 * sessions             — remove expired (already done elsewhere, this is a safety net)
 * site_invitations     — remove accepted or expired after 7 days
 * build_jobs           — keep 90 days, strip logs from >7-day-old jobs to save space
 * admin_audit_log      — keep 365 days (configurable via AUDIT_LOG_RETENTION_DAYS)
 *
 * All deletions are batched (max 5,000 rows per run) to avoid long-lock transactions.
 */

import { db, sessionsTable, siteInvitationsTable, siteAnalyticsTable,
         formSubmissionsTable, buildJobsTable, webhookDeliveriesTable } from "@workspace/db";
import { lt, and, isNotNull, sql, lte } from "drizzle-orm";
import logger from "./logger";

const BATCH = 5_000;

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86_400_000);
}

async function deleteBatch(table: string, condition: string, label: string): Promise<number> {
  const result = await db.execute(
    sql.raw(`DELETE FROM "${table}" WHERE ctid IN (
      SELECT ctid FROM "${table}" WHERE ${condition} LIMIT ${BATCH}
    )`)
  );
  const count = (result as any).rowCount ?? 0;
  if (count > 0) logger.info({ table, count }, `[retention] Pruned ${label}`);
  return count;
}

export async function runRetentionCleanup(): Promise<void> {
  const analyticsRetain  = parseInt(process.env.ANALYTICS_RETENTION_DAYS  ?? "90",  10);
  const formRetain       = parseInt(process.env.FORM_RETENTION_DAYS       ?? "365", 10);
  const auditRetain      = parseInt(process.env.AUDIT_LOG_RETENTION_DAYS  ?? "365", 10);

  logger.info("[retention] Starting cleanup run");
  const start = Date.now();
  let totalPruned = 0;

  // ── Site analytics rows older than retention window ────────────────────────
  totalPruned += await deleteBatch(
    "site_analytics",
    `hour < '${daysAgo(analyticsRetain).toISOString()}'`,
    `analytics older than ${analyticsRetain}d`
  );

  // ── Form submissions beyond retention ─────────────────────────────────────
  totalPruned += await deleteBatch(
    "form_submissions",
    `created_at < '${daysAgo(formRetain).toISOString()}'`,
    `form submissions older than ${formRetain}d`
  );

  // ── Webhook delivery log older than 30 days ────────────────────────────────
  totalPruned += await deleteBatch(
    "webhook_deliveries",
    `created_at < '${daysAgo(30).toISOString()}'`,
    "webhook deliveries >30d"
  );

  // ── Expired / accepted invitations older than 7 days ──────────────────────
  totalPruned += await deleteBatch(
    "site_invitations",
    `expires_at < '${daysAgo(7).toISOString()}'`,
    "expired invitations"
  );

  // ── Expired sessions (safety net — auth middleware also cleans these) ─────
  totalPruned += await deleteBatch(
    "sessions",
    `expire < '${new Date().toISOString()}'`,
    "expired sessions"
  );

  // ── Build job logs older than 7 days — strip log column to save space ─────
  // Keep the job metadata (status, timing) but free the potentially large log text
  // PostgreSQL does not support LIMIT in UPDATE; use a subquery to cap batch size.
  const logPurgeResult = await db.execute(
    sql.raw(`UPDATE build_jobs SET log = '[log purged after 7 days]'
             WHERE id IN (
               SELECT id FROM build_jobs
               WHERE finished_at < '${daysAgo(7).toISOString()}'
                 AND log IS NOT NULL
                 AND log != '[log purged after 7 days]'
               LIMIT ${BATCH}
             )`)
  );
  const logsPurged = (logPurgeResult as any).rowCount ?? 0;
  if (logsPurged > 0) logger.info({ count: logsPurged }, "[retention] Purged old build logs");

  // ── Build jobs older than 90 days ─────────────────────────────────────────
  totalPruned += await deleteBatch(
    "build_jobs",
    `created_at < '${daysAgo(90).toISOString()}'`,
    "build jobs >90d"
  );

  // ── Admin audit log beyond retention ──────────────────────────────────────
  totalPruned += await deleteBatch(
    "admin_audit_log",
    `created_at < '${daysAgo(auditRetain).toISOString()}'`,
    `audit log older than ${auditRetain}d`
  );

  logger.info({ totalPruned, durationMs: Date.now() - start }, "[retention] Cleanup complete");
}

const INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
let retentionTimer: NodeJS.Timeout | null = null;

export function startRetentionJob(): void {
  // Stagger first run by 5 minutes to not spike on startup
  setTimeout(() => {
    runRetentionCleanup().catch(err => logger.error({ err }, "[retention] Initial run failed"));
    retentionTimer = setInterval(() => {
      runRetentionCleanup().catch(err => logger.error({ err }, "[retention] Scheduled run failed"));
    }, INTERVAL_MS);
  }, 5 * 60 * 1000);

  logger.info("[retention] Cleanup job scheduled (every 6h, first run in 5min)");
}

export function stopRetentionJob(): void {
  if (retentionTimer) { clearInterval(retentionTimer); retentionTimer = null; }
}
