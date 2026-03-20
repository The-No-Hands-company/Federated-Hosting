import { Router, type IRouter, type Request, type Response } from "express";
import { db, sitesTable, siteAnalyticsTable, analyticsBufferTable, siteMembersTable } from "@workspace/db";
import { eq, and, gte, lte, sql, desc } from "drizzle-orm";
import { asyncHandler, AppError } from "../lib/errors";
import { requireAdmin } from "../middleware/requireAdmin";

const router: IRouter = Router();

/** GET /api/sites/:id/analytics?period=24h|7d|30d */
router.get("/sites/:id/analytics", asyncHandler(async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();

  const siteId = parseInt(req.params.id as string, 10);
  if (Number.isNaN(siteId)) throw AppError.badRequest("Invalid site ID");

  const [site] = await db.select({ id: sitesTable.id, ownerId: sitesTable.ownerId })
    .from(sitesTable).where(eq(sitesTable.id, siteId));
  if (!site) throw AppError.notFound("Site not found");

  // Allow site owner or team members — reject everyone else
  if (site.ownerId !== req.user.id) {
    const [membership] = await db
      .select({ id: siteMembersTable.id })
      .from(siteMembersTable)
      .where(and(eq(siteMembersTable.siteId, siteId), eq(siteMembersTable.userId, req.user.id)));
    if (!membership) throw AppError.forbidden("Only the site owner or members can view analytics");
  }

  const period = (req.query.period as string) || "24h";
  const now = new Date();
  let since: Date;

  switch (period) {
    case "7d":  since = new Date(now.getTime() - 7  * 24 * 60 * 60 * 1000); break;
    case "30d": since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); break;
    default:    since = new Date(now.getTime() - 24 * 60 * 60 * 1000);      break;
  }

  const hourly = await db
    .select()
    .from(siteAnalyticsTable)
    .where(and(eq(siteAnalyticsTable.siteId, siteId), gte(siteAnalyticsTable.hour, since)))
    .orderBy(siteAnalyticsTable.hour);

  const totals = hourly.reduce(
    (acc, row) => ({
      hits: acc.hits + Number(row.hits),
      bytesServed: acc.bytesServed + Number(row.bytesServed),
      uniqueIps: acc.uniqueIps + row.uniqueIps,
    }),
    { hits: 0, bytesServed: 0, uniqueIps: 0 },
  );

  // Aggregate top referrers across all hours
  const referrerMap = new Map<string, number>();
  const pathMap = new Map<string, number>();
  for (const row of hourly) {
    try {
      const refs: Array<{ referrer: string; count: number }> = JSON.parse(row.topReferrers ?? "[]");
      for (const r of refs) referrerMap.set(r.referrer, (referrerMap.get(r.referrer) ?? 0) + r.count);
      const paths: Array<{ path: string; count: number }> = JSON.parse(row.topPaths ?? "[]");
      for (const p of paths) pathMap.set(p.path, (pathMap.get(p.path) ?? 0) + p.count);
    } catch { /* ignore malformed JSON */ }
  }

  const topReferrers = [...referrerMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([referrer, count]) => ({ referrer, count }));

  const topPaths = [...pathMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([path, count]) => ({ path, count }));

  res.json({ period, totals, hourly, topReferrers, topPaths });
}));

/** GET /api/admin/analytics — network-wide aggregate */
router.get("/admin/analytics", requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();

  const now = new Date();
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const since7d  = new Date(now.getTime() - 7  * 24 * 60 * 60 * 1000);

  const [row24h] = await db
    .select({
      hits: sql<number>`coalesce(sum(${siteAnalyticsTable.hits}), 0)`,
      bytes: sql<number>`coalesce(sum(${siteAnalyticsTable.bytesServed}), 0)`,
    })
    .from(siteAnalyticsTable)
    .where(gte(siteAnalyticsTable.hour, since24h));

  const [row7d] = await db
    .select({
      hits: sql<number>`coalesce(sum(${siteAnalyticsTable.hits}), 0)`,
      bytes: sql<number>`coalesce(sum(${siteAnalyticsTable.bytesServed}), 0)`,
    })
    .from(siteAnalyticsTable)
    .where(gte(siteAnalyticsTable.hour, since7d));

  // Top sites by hits in last 24h
  const topSites = await db
    .select({
      siteId: siteAnalyticsTable.siteId,
      name: sitesTable.name,
      domain: sitesTable.domain,
      hits: sql<number>`coalesce(sum(${siteAnalyticsTable.hits}), 0)`,
    })
    .from(siteAnalyticsTable)
    .leftJoin(sitesTable, eq(siteAnalyticsTable.siteId, sitesTable.id))
    .where(gte(siteAnalyticsTable.hour, since24h))
    .groupBy(siteAnalyticsTable.siteId, sitesTable.name, sitesTable.domain)
    .orderBy(desc(sql`sum(${siteAnalyticsTable.hits})`))
    .limit(10);

  res.json({
    last24h: { hits: Number(row24h?.hits ?? 0), bytesServed: Number(row24h?.bytes ?? 0) },
    last7d:  { hits: Number(row7d?.hits  ?? 0), bytesServed: Number(row7d?.bytes  ?? 0) },
    topSites,
  });
}));

/**
 * GET /api/sites/:id/analytics/export?period=7d|30d|all
 * Download raw analytics data as CSV.
 */
router.get("/sites/:id/analytics/export", asyncHandler(async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();
  const siteId = parseInt(req.params.id as string, 10);
  if (Number.isNaN(siteId)) throw AppError.badRequest("Invalid site ID");

  const [site] = await db.select({ ownerId: sitesTable.ownerId, domain: sitesTable.domain })
    .from(sitesTable).where(eq(sitesTable.id, siteId));
  if (!site) throw AppError.notFound("Site not found");
  if (site.ownerId !== req.user.id) throw AppError.forbidden();

  const period = (req.query.period as string) || "30d";
  const now = new Date();
  let since: Date | null = null;
  if (period === "7d")  since = new Date(now.getTime() - 7  * 86400_000);
  if (period === "30d") since = new Date(now.getTime() - 30 * 86400_000);

  const rows = await db
    .select()
    .from(siteAnalyticsTable)
    .where(
      since
        ? and(eq(siteAnalyticsTable.siteId, siteId), gte(siteAnalyticsTable.hour, since))
        : eq(siteAnalyticsTable.siteId, siteId)
    )
    .orderBy(siteAnalyticsTable.hour);

  const csv = [
    "hour,hits,bytes_served,unique_ips",
    ...rows.map(r =>
      `${r.hour?.toISOString() ?? ""},${r.hits},${r.bytesServed},${r.uniqueIps}`
    ),
  ].join("\n");

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="${site.domain}-analytics-${period}.csv"`);
  res.send(csv);
}));

/**
 * GET /api/sites/:id/analytics/referrers?period=7d
 * Top referrers aggregated across the period.
 */
router.get("/sites/:id/analytics/referrers", asyncHandler(async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();
  const siteId = parseInt(req.params.id as string, 10);
  if (Number.isNaN(siteId)) throw AppError.badRequest("Invalid site ID");

  const [site] = await db.select({ ownerId: sitesTable.ownerId })
    .from(sitesTable).where(eq(sitesTable.id, siteId));
  if (!site) throw AppError.notFound("Site not found");
  if (site.ownerId !== req.user.id) throw AppError.forbidden();

  const period = (req.query.period as string) || "7d";
  const since  = new Date(Date.now() - (period === "30d" ? 30 : 7) * 86400_000);

  const rows = await db
    .select({ topReferrers: siteAnalyticsTable.topReferrers })
    .from(siteAnalyticsTable)
    .where(and(eq(siteAnalyticsTable.siteId, siteId), gte(siteAnalyticsTable.hour, since)));

  // Aggregate referrer counts from JSONB arrays across all rows
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const refs = row.topReferrers as Array<{ referrer: string; count: number }> | null;
    if (!refs) continue;
    for (const { referrer, count } of refs) {
      if (!referrer) continue;
      counts[referrer] = (counts[referrer] ?? 0) + count;
    }
  }

  const sorted = Object.entries(counts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 50)
    .map(([referrer, hits]) => ({ referrer, hits }));

  res.json({ period, referrers: sorted });
}));

export default router;

// ── In-memory SSE subscriptions ────────────────────────────────────────────────
// Site owners can subscribe to a real-time event stream of hits on their sites.
// Events are forwarded from the analytics buffer flush to all active subscribers.

type SseClient = { siteId: number; res: import("express").Response; userId: string };
const sseClients = new Set<SseClient>();

export function broadcastAnalyticsHit(siteId: number, path: string, referrer: string | null): void {
  for (const client of sseClients) {
    if (client.siteId !== siteId) continue;
    try {
      client.res.write(`data: ${JSON.stringify({ path, referrer, ts: Date.now() })}\n\n`);
    } catch {
      sseClients.delete(client);
    }
  }
}

// Append this route to the analytics router
router.get("/sites/:id/analytics/stream", asyncHandler(async (req, res) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();
  const siteId = parseInt(req.params.id as string, 10);
  if (Number.isNaN(siteId)) throw AppError.badRequest("Invalid site ID");

  const [site] = await db.select({ ownerId: sitesTable.ownerId })
    .from(sitesTable).where(eq(sitesTable.id, siteId));
  if (!site) throw AppError.notFound("Site not found");
  if (site.ownerId !== req.user.id) throw AppError.forbidden();

  // Set up SSE headers
  res.setHeader("Content-Type",  "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection",    "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // disable nginx buffering
  res.flushHeaders();

  // Send initial ping so client knows connection is live
  res.write(`data: ${JSON.stringify({ type: "connected", siteId })}\n\n`);

  const client: SseClient = { siteId, res, userId: req.user.id };
  sseClients.add(client);

  // Heartbeat every 25 seconds to keep connection alive through proxies
  const heartbeat = setInterval(() => {
    try { res.write(": heartbeat\n\n"); } catch { clearInterval(heartbeat); }
  }, 25_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    sseClients.delete(client);
  });
}));
