/**
 * Abuse reporting and IP ban management routes.
 *
 * Public:
 *   POST /api/abuse/report         — Submit an abuse report
 *
 * Admin-only:
 *   GET  /api/abuse/reports        — List reports (filterable by status)
 *   PATCH /api/abuse/reports/:id   — Update status, add review notes
 *   POST /api/abuse/reports/:id/takedown — Take site offline + resolve report
 *
 *   GET  /api/admin/ip-bans        — List bans
 *   POST /api/admin/ip-bans        — Create ban
 *   DELETE /api/admin/ip-bans/:id  — Remove ban
 */

import { Router, Request, Response } from "express";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import {
  abuseReportsTable, ipBansTable, sitesTable,
  adminAuditLogTable,
} from "@workspace/db";
import { eq, desc, and, isNull, or, gt } from "drizzle-orm";
import { asyncHandler, AppError } from "../lib/errors.js";
import { requireAdmin } from "../middleware/requireAdmin.js";
import { invalidateBanCache } from "../middleware/ipBan.js";
import { rateLimiter } from "../middleware/rateLimiter.js";

export const router = Router();

// ── Public: submit an abuse report ────────────────────────────────────────────

const ReportBody = z.object({
  siteDomain:    z.string().min(1).max(253),
  reason:        z.enum(["spam","phishing","malware","csam","copyright","harassment","illegal_content","other"]),
  description:   z.string().max(2000).optional(),
  evidenceUrl:   z.url().optional(),
  reporterEmail: z.email().optional(),
});

router.post("/report", rateLimiter, asyncHandler(async (req: Request, res: Response) => {
  const parsed = ReportBody.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest(parsed.error.message);

  const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0].trim()
    ?? req.socket?.remoteAddress
    ?? null;

  // Resolve site
  const [site] = await db
    .select({ id: sitesTable.id })
    .from(sitesTable)
    .where(eq(sitesTable.domain, parsed.data.siteDomain))
    .limit(1);

  if (!site) throw AppError.notFound("Site not found");

  await db.insert(abuseReportsTable).values({
    siteId:        site.id,
    siteDomain:    parsed.data.siteDomain,
    reporterIp:    ip,
    reporterEmail: parsed.data.reporterEmail ?? null,
    reason:        parsed.data.reason,
    description:   parsed.data.description ?? null,
    evidenceUrl:   parsed.data.evidenceUrl ?? null,
  });

  res.status(201).json({ ok: true, message: "Report received. Thank you." });
}));

// ── Admin: list reports ───────────────────────────────────────────────────────

router.get("/reports", requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const status = req.query.status as string | undefined;
  const conditions = status ? [eq(abuseReportsTable.status, status as any)] : [];

  const reports = await db
    .select()
    .from(abuseReportsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(abuseReportsTable.createdAt))
    .limit(100);

  res.json({ data: reports });
}));

// ── Admin: update report status ────────────────────────────────────────────────

const ReviewBody = z.object({
  status:      z.enum(["pending","under_review","resolved_removed","resolved_no_action","escalated"]),
  reviewNotes: z.string().max(2000).optional(),
});

router.patch("/reports/:id", requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) throw AppError.badRequest("Invalid report ID");
  const parsed = ReviewBody.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest(parsed.error.message);

  const [updated] = await db
    .update(abuseReportsTable)
    .set({
      status:      parsed.data.status,
      reviewNotes: parsed.data.reviewNotes ?? null,
      reviewedBy:  (req as any).user?.id,
      reviewedAt:  new Date(),
      updatedAt:   new Date(),
    })
    .where(eq(abuseReportsTable.id, id))
    .returning();

  if (!updated) throw AppError.notFound("Report not found");
  res.json(updated);
}));

// ── Admin: takedown — suspend site + resolve report ───────────────────────────

router.post("/reports/:id/takedown", requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) throw AppError.badRequest("Invalid report ID");

  const [report] = await db
    .select()
    .from(abuseReportsTable)
    .where(eq(abuseReportsTable.id, id))
    .limit(1);

  if (!report) throw AppError.notFound("Report not found");

  // Suspend the site
  await db.update(sitesTable)
    .set({ status: "suspended" })
    .where(eq(sitesTable.id, report.siteId));

  // Resolve the report
  await db.update(abuseReportsTable)
    .set({
      status:      "resolved_removed",
      actionTaken: 1,
      reviewedBy:  (req as any).user?.id,
      reviewedAt:  new Date(),
      updatedAt:   new Date(),
    })
    .where(eq(abuseReportsTable.id, id));

  // Audit log
  await db.insert(adminAuditLogTable).values({
    adminId: (req as any).user?.id,
    action:  "site_takedown",
    target:  `site:${report.siteId}:${report.siteDomain}`,
    detail:  `Abuse report #${id} (${report.reason})`,
  }).catch(() => {});

  res.json({ ok: true, message: `Site ${report.siteDomain} suspended.` });
}));

// ── Admin: IP bans ────────────────────────────────────────────────────────────

router.get("/ip-bans", requireAdmin, asyncHandler(async (_req: Request, res: Response) => {
  const bans = await db
    .select()
    .from(ipBansTable)
    .orderBy(desc(ipBansTable.createdAt))
    .limit(500);
  res.json({ data: bans });
}));

const BanBody = z.object({
  ipAddress: z.string().min(7).max(45),
  cidrRange: z.string().optional(),
  reason:    z.string().max(500).optional(),
  scope:     z.enum(["api","sites","all"]).default("all"),
  expiresAt: z.string().datetime().optional(),
});

router.post("/ip-bans", requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const parsed = BanBody.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest(parsed.error.message);

  const [ban] = await db.insert(ipBansTable).values({
    ipAddress: parsed.data.ipAddress,
    cidrRange: parsed.data.cidrRange ?? null,
    reason:    parsed.data.reason ?? null,
    scope:     parsed.data.scope,
    bannedBy:  (req as any).user?.id,
    expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
  }).returning();

  // If a CIDR range is specified, flush the full cache (any IP could be affected)
  invalidateBanCache(parsed.data.cidrRange ? undefined : parsed.data.ipAddress);

  await db.insert(adminAuditLogTable).values({
    adminId: (req as any).user?.id,
    action:  "ip_ban",
    target:  parsed.data.ipAddress,
    detail:  parsed.data.reason ?? "",
  }).catch(() => {});

  res.status(201).json(ban);
}));

router.delete("/ip-bans/:id", requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) throw AppError.badRequest("Invalid ban ID");

  const [deleted] = await db.delete(ipBansTable)
    .where(eq(ipBansTable.id, id))
    .returning();

  if (!deleted) throw AppError.notFound("Ban not found");
  invalidateBanCache(deleted.ipAddress);
  res.sendStatus(204);
}));
