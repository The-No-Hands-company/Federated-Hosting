import { Router, type IRouter, type Request, type Response } from "express";
import {
  db, nodesTable, sitesTable, siteDeploymentsTable,
  federationEventsTable, usersTable, siteAnalyticsTable, nodeTrustTable,
} from "@workspace/db";
import { eq, count, sql, desc, gte, and } from "drizzle-orm";
import { asyncHandler, AppError } from "../lib/errors";
import { writeLimiter } from "../middleware/rateLimiter";
import { requireAdmin } from "../middleware/requireAdmin";
import { getSiteHealthSummary } from "../lib/siteHealthMonitor";
import { auditLog } from "../lib/auditLog";
import { z } from "zod/v4";
import os from "os";
import { readFile } from "node:fs/promises";

const router: IRouter = Router();

// ── Node operator settings ────────────────────────────────────────────────────

const UpdateNodeSettingsBody = z.object({
  name: z.string().min(1).max(120).optional(),
  region: z.string().max(60).optional(),
  maxStorageGb: z.number().min(1).optional(),
  operatorEmail: z.string().email().optional(),
  description: z.string().max(500).optional(),
});

/** GET /api/admin/overview — full operator dashboard */
router.get("/admin/overview", requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();

  const [localNode] = await db.select().from(nodesTable).where(eq(nodesTable.isLocalNode, 1));
  if (!localNode) throw AppError.notFound("Local node not initialised");

  const [{ totalSites }] = await db.select({ totalSites: count() }).from(sitesTable);
  const [{ activeSites }] = await db.select({ activeSites: count() }).from(sitesTable).where(eq(sitesTable.status, "active"));
  const [{ totalUsers }] = await db.select({ totalUsers: count() }).from(usersTable);
  const [{ totalDeploys }] = await db.select({ totalDeploys: count() }).from(siteDeploymentsTable);
  const [{ totalNodes }] = await db.select({ totalNodes: count() }).from(nodesTable);
  const [{ activeNodes }] = await db.select({ activeNodes: count() }).from(nodesTable).where(eq(nodesTable.status, "active"));

  // Last 24h analytics
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [analytics24h] = await db
    .select({
      hits: sql<number>`coalesce(sum(${siteAnalyticsTable.hits}), 0)`,
      bytesServed: sql<number>`coalesce(sum(${siteAnalyticsTable.bytesServed}), 0)`,
    })
    .from(siteAnalyticsTable)
    .where(gte(siteAnalyticsTable.hour, since));

  // Last 10 federation events
  const recentEvents = await db
    .select()
    .from(federationEventsTable)
    .orderBy(desc(federationEventsTable.createdAt))
    .limit(10);

  // Storage breakdown by site
  const storageByOwner = await db
    .select({
      ownerId: sitesTable.ownerId,
      totalMb: sql<number>`sum(${sitesTable.storageUsedMb})`,
      siteCount: count(),
    })
    .from(sitesTable)
    .groupBy(sitesTable.ownerId)
    .orderBy(desc(sql`sum(${sitesTable.storageUsedMb})`))
    .limit(20);

  // System info
  const systemInfo = {
    platform: os.platform(),
    arch: os.arch(),
    hostname: os.hostname(),
    totalMemMb: Math.round(os.totalmem() / 1024 / 1024),
    freeMemMb: Math.round(os.freemem() / 1024 / 1024),
    loadAvg: os.loadavg(),
    uptimeSeconds: os.uptime(),
    nodeVersion: process.version,
  };

  res.json({
    node: localNode,
    summary: {
      totalSites: Number(totalSites),
      activeSites: Number(activeSites),
      totalUsers: Number(totalUsers),
      totalDeploys: Number(totalDeploys),
      totalNodes: Number(totalNodes),
      activeNodes: Number(activeNodes),
    },
    analytics24h: {
      hits: Number(analytics24h?.hits ?? 0),
      bytesServed: Number(analytics24h?.bytesServed ?? 0),
    },
    recentEvents,
    storageByOwner,
    systemInfo,
  });
}));

/** PATCH /api/admin/node — update local node settings */
router.patch("/admin/node", requireAdmin, writeLimiter, asyncHandler(async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();

  const parsed = UpdateNodeSettingsBody.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest(parsed.error.message);

  const [localNode] = await db.select().from(nodesTable).where(eq(nodesTable.isLocalNode, 1));
  if (!localNode) throw AppError.notFound("Local node not found");

  const updateData: Record<string, unknown> = {};
  if (parsed.data.name)           updateData.name = parsed.data.name;
  if (parsed.data.region)         updateData.region = parsed.data.region;
  if (parsed.data.maxStorageGb)   updateData.maxStorageGb = parsed.data.maxStorageGb;
  if (parsed.data.operatorEmail)  updateData.operatorEmail = parsed.data.operatorEmail;
  if (parsed.data.description)    updateData.description = parsed.data.description;

  if (Object.keys(updateData).length === 0) throw AppError.badRequest("No valid fields to update");

  const [updated] = await db
    .update(nodesTable)
    .set(updateData)
    .where(eq(nodesTable.isLocalNode, 1))
    .returning();

  await auditLog(req, "node.settings.update",
    { type: "node", id: localNode.id },
    { before: { name: localNode.name, region: localNode.region, operatorEmail: localNode.operatorEmail }, after: updateData },
  );

  res.json(updated);
}));

/** GET /api/admin/users — list all users (paginated) */
router.get("/admin/users", requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();

  const page  = Math.max(1, parseInt((req.query.page as string) || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || "25", 10)));
  const offset = (page - 1) * limit;

  const [{ total }] = await db.select({ total: count() }).from(usersTable);

  const users = await db
    .select({
      id:              usersTable.id,
      email:           usersTable.email,
      firstName:       usersTable.firstName,
      lastName:        usersTable.lastName,
      profileImageUrl: usersTable.profileImageUrl,
      createdAt:       usersTable.createdAt,
      emailVerified:   usersTable.emailVerified,
      storageCapMb:    usersTable.storageCapMb,
      suspendedAt:     usersTable.suspendedAt,
      isAdmin:         usersTable.isAdmin,
      siteCount: sql<number>`(select count(*) from sites where sites.owner_id = users.id)`,
    })
    .from(usersTable)
    .orderBy(desc(usersTable.createdAt))
    .limit(limit)
    .offset(offset);

  res.json({ data: users, meta: { total: Number(total), page, limit } });
}));

/** GET /api/admin/sites — all sites with owner info */
router.get("/admin/sites", requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();

  const page  = Math.max(1, parseInt((req.query.page as string) || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || "25", 10)));
  const offset = (page - 1) * limit;

  const [{ total }] = await db.select({ total: count() }).from(sitesTable);

  const sites = await db
    .select({
      id: sitesTable.id,
      name: sitesTable.name,
      domain: sitesTable.domain,
      status: sitesTable.status,
      visibility: sitesTable.visibility,
      ownerId: sitesTable.ownerId,
      ownerEmail: sitesTable.ownerEmail,
      storageUsedMb: sitesTable.storageUsedMb,
      hitCount: sitesTable.hitCount,
      createdAt: sitesTable.createdAt,
    })
    .from(sitesTable)
    .orderBy(desc(sitesTable.createdAt))
    .limit(limit)
    .offset(offset);

  res.json({ data: sites, meta: { total: Number(total), page, limit } });
}));

/** GET /api/admin/audit-log — paginated admin action history */
router.get("/admin/audit-log", requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();

  const page   = Math.max(1, parseInt((req.query.page  as string) || "1",  10));
  const limit  = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || "50", 10)));
  const offset = (page - 1) * limit;

  const [{ total }] = await db
    .select({ total: count() })
    .from(sql`admin_audit_log` as any);

  const entries = await db.execute(sql`
    SELECT id, actor_id, actor_email, action, target_type, target_id,
           metadata, ip_address, user_agent, created_at
    FROM admin_audit_log
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `);

  res.json({ data: entries.rows, meta: { total: Number(total ?? 0), page, limit } });
}));

/** GET /api/admin/site-health — health status of all monitored public sites */
router.get("/admin/site-health", requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();
  res.json(getSiteHealthSummary());
}));

/** GET /api/admin/cloud-routes — latest synced Nexus Cloud route table snapshot */
router.get("/admin/cloud-routes", requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();

  const snapshotPath = process.env.NEXUS_CLOUD_ROUTE_TABLE_PATH ?? "./data/cloud-route-table.json";
  try {
    const raw = await readFile(snapshotPath, "utf8");
    const parsed = JSON.parse(raw) as { syncedAt?: string; routes?: unknown[] };
    const routes = Array.isArray(parsed.routes) ? parsed.routes : [];
    res.json({
      path: snapshotPath,
      syncedAt: parsed.syncedAt ?? null,
      routeCount: routes.length,
      routes,
    });
  } catch (error) {
    const errorCode = (error as NodeJS.ErrnoException).code;
    if (errorCode === "ENOENT") throw AppError.notFound("Cloud route snapshot not found");
    throw AppError.internal("Failed to read cloud route snapshot");
  }
}));

/** GET /api/admin/node-trust — federation node trust scores */
router.get("/admin/node-trust", requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();

  const records = await db
    .select()
    .from(nodeTrustTable)
    .orderBy(desc(nodeTrustTable.successfulPings))
    .limit(200);

  res.json({ data: records });
}));

/** PATCH /api/admin/node-trust/:domain — manually set trust level */
router.patch("/admin/node-trust/:domain", requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();

  const { domain } = req.params as { domain: string };
  const { trustLevel, reviewNotes } = req.body as { trustLevel?: string; reviewNotes?: string };

  const validLevels = ["unverified", "verified", "trusted", "blocked"];
  if (trustLevel && !validLevels.includes(trustLevel)) {
    throw AppError.badRequest(`trustLevel must be one of: ${validLevels.join(", ")}`);
  }

  const [updated] = await db
    .update(nodeTrustTable)
    .set({
      trustLevel:       trustLevel as any ?? undefined,
      reviewNotes:      reviewNotes ?? undefined,
      manuallyReviewed: 1,
      reviewedBy:       (req as any).user?.id,
      updatedAt:        new Date(),
    })
    .where(eq(nodeTrustTable.nodeDomain, domain))
    .returning();

  if (!updated) throw AppError.notFound("Node trust record not found");
  res.json(updated);
}));

/** PATCH /api/admin/users/:id/storage-cap — set per-user storage cap */
router.patch("/admin/users/:id/storage-cap", requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();

  const { id } = req.params as { id: string };
  const { storageCapMb } = req.body as { storageCapMb?: number };

  if (storageCapMb === undefined || typeof storageCapMb !== "number" || storageCapMb < 0) {
    throw AppError.badRequest("storageCapMb must be a non-negative number (0 = no cap)");
  }

  const [updated] = await db
    .update(usersTable)
    .set({ storageCapMb })
    .where(eq(usersTable.id, id))
    .returning({ id: usersTable.id, email: usersTable.email, storageCapMb: usersTable.storageCapMb });

  if (!updated) throw AppError.notFound("User not found");

  res.json({
    ...updated,
    message: storageCapMb === 0
      ? "Storage cap removed — user is unlimited (node capacity is the only limit)"
      : `Storage cap set to ${storageCapMb}MB`,
  });
}));

/** PATCH /api/admin/users/:id/suspend — suspend or reinstate a user */
router.patch("/admin/users/:id/suspend", requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();

  const { id } = req.params as { id: string };
  const { suspended } = req.body as { suspended: boolean };

  const [updated] = await db
    .update(usersTable)
    .set({ suspendedAt: suspended ? new Date() : null })
    .where(eq(usersTable.id, id))
    .returning({ id: usersTable.id, email: usersTable.email, suspendedAt: usersTable.suspendedAt });

  if (!updated) throw AppError.notFound("User not found");
  res.json({ ...updated, message: suspended ? "User suspended" : "User reinstated" });
}));

export default router;
