import { requireScope } from "../middleware/tokenAuth";
/**
 * Site redirect rules and custom response headers.
 *
 * Redirect rules work like Netlify's _redirects file:
 *   - Source path patterns: /old-path, /blog/:slug, /old/*
 *   - Destination: /new-path, /blog/:slug/index.html, https://external.com
 *   - Status codes: 301 (permanent), 302 (temporary), 200 (rewrite), 404, 410
 *
 * Custom headers work like Netlify's _headers file:
 *   - Path pattern: /*, /api/*, /assets/*
 *   - Name/value: X-Frame-Options: DENY, Content-Security-Policy: ...
 *
 * Routes:
 *   GET    /api/sites/:id/redirects        — list redirect rules
 *   POST   /api/sites/:id/redirects        — create redirect rule
 *   PUT    /api/sites/:id/redirects        — replace all rules (bulk update)
 *   DELETE /api/sites/:id/redirects/:ruleId — delete a rule
 *
 *   GET    /api/sites/:id/headers          — list custom headers
 *   POST   /api/sites/:id/headers          — create custom header
 *   PUT    /api/sites/:id/headers          — replace all headers (bulk update)
 *   DELETE /api/sites/:id/headers/:headerId — delete a header
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod/v4";
import { db, sitesTable, siteRedirectRulesTable, siteCustomHeadersTable } from "@workspace/db";
import { eq, and, asc } from "drizzle-orm";
import { asyncHandler, AppError } from "../lib/errors";
import { writeLimiter } from "../middleware/rateLimiter";
import { invalidateSiteCache } from "../lib/domainCache";

const router: IRouter = Router();

const ALLOWED_STATUS = new Set([200, 301, 302, 303, 307, 308, 404, 410]);

const RedirectRuleBody = z.object({
  src:      z.string().min(1).max(500),
  dest:     z.string().min(1).max(2000),
  status:   z.number().int().refine(s => ALLOWED_STATUS.has(s), { message: "Status must be 200, 301, 302, 303, 307, 308, 404, or 410" }).default(301),
  force:    z.boolean().default(false),
  position: z.number().int().min(0).default(0),
});

const CustomHeaderBody = z.object({
  path:  z.string().min(1).max(500).default("/*"),
  name:  z.string().min(1).max(200).regex(/^[a-zA-Z0-9\-_]+$/, "Header name must be alphanumeric with hyphens/underscores"),
  value: z.string().min(1).max(2000),
});

async function requireSiteOwner(siteId: number, userId: string) {
  const [site] = await db.select({ ownerId: sitesTable.ownerId }).from(sitesTable).where(eq(sitesTable.id, siteId));
  if (!site) throw AppError.notFound("Site not found");
  if (site.ownerId !== userId) throw AppError.forbidden("Only the site owner can manage redirect rules");
}

// ── Redirect rules ────────────────────────────────────────────────────────────

router.get("/sites/:id/redirects", asyncHandler(async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();
  const siteId = parseInt(req.params.id as string, 10);
  if (isNaN(siteId)) throw AppError.badRequest("Invalid site ID");
  await requireSiteOwner(siteId, req.user.id);

  const rules = await db.select().from(siteRedirectRulesTable)
    .where(eq(siteRedirectRulesTable.siteId, siteId))
    .orderBy(asc(siteRedirectRulesTable.position));
  res.json(rules);
}));

router.post("/sites/:id/redirects", writeLimiter, requireScope("write"), asyncHandler(async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();
  const siteId = parseInt(req.params.id as string, 10);
  if (isNaN(siteId)) throw AppError.badRequest("Invalid site ID");
  await requireSiteOwner(siteId, req.user.id);

  const parsed = RedirectRuleBody.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest(parsed.error.message);

  const [rule] = await db.insert(siteRedirectRulesTable)
    .values({ siteId, ...parsed.data, force: parsed.data.force ? 1 : 0 })
    .returning();

  invalidateSiteCache(siteId);
  res.status(201).json(rule);
}));

router.put("/sites/:id/redirects", writeLimiter, requireScope("write"), asyncHandler(async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();
  const siteId = parseInt(req.params.id as string, 10);
  if (isNaN(siteId)) throw AppError.badRequest("Invalid site ID");
  await requireSiteOwner(siteId, req.user.id);

  const rules = z.array(RedirectRuleBody).max(100).safeParse(req.body);
  if (!rules.success) throw AppError.badRequest(rules.error.message);

  await db.transaction(async (tx) => {
    await tx.delete(siteRedirectRulesTable).where(eq(siteRedirectRulesTable.siteId, siteId));
    if (rules.data.length > 0) {
      await tx.insert(siteRedirectRulesTable).values(
        rules.data.map((r, i) => ({ siteId, ...r, force: r.force ? 1 : 0, position: r.position ?? i }))
      );
    }
  });

  const updated = await db.select().from(siteRedirectRulesTable)
    .where(eq(siteRedirectRulesTable.siteId, siteId))
    .orderBy(asc(siteRedirectRulesTable.position));

  invalidateSiteCache(siteId);
  res.json(updated);
}));

router.delete("/sites/:id/redirects/:ruleId", writeLimiter, asyncHandler(async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();
  const siteId  = parseInt(req.params.id as string, 10);
  const ruleId  = parseInt(req.params.ruleId as string, 10);
  if (isNaN(siteId) || isNaN(ruleId)) throw AppError.badRequest("Invalid ID");
  await requireSiteOwner(siteId, req.user.id);

  await db.delete(siteRedirectRulesTable).where(
    and(eq(siteRedirectRulesTable.id, ruleId), eq(siteRedirectRulesTable.siteId, siteId))
  );
  invalidateSiteCache(siteId);
  res.sendStatus(204);
}));

// ── Custom headers ────────────────────────────────────────────────────────────

router.get("/sites/:id/headers", asyncHandler(async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();
  const siteId = parseInt(req.params.id as string, 10);
  if (isNaN(siteId)) throw AppError.badRequest("Invalid site ID");
  await requireSiteOwner(siteId, req.user.id);

  const headers = await db.select().from(siteCustomHeadersTable)
    .where(eq(siteCustomHeadersTable.siteId, siteId));
  res.json(headers);
}));

router.post("/sites/:id/headers", writeLimiter, asyncHandler(async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();
  const siteId = parseInt(req.params.id as string, 10);
  if (isNaN(siteId)) throw AppError.badRequest("Invalid site ID");
  await requireSiteOwner(siteId, req.user.id);

  const parsed = CustomHeaderBody.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest(parsed.error.message);

  const [header] = await db.insert(siteCustomHeadersTable)
    .values({ siteId, ...parsed.data })
    .returning();

  invalidateSiteCache(siteId);
  res.status(201).json(header);
}));

router.put("/sites/:id/headers", writeLimiter, asyncHandler(async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();
  const siteId = parseInt(req.params.id as string, 10);
  if (isNaN(siteId)) throw AppError.badRequest("Invalid site ID");
  await requireSiteOwner(siteId, req.user.id);

  const headers = z.array(CustomHeaderBody).max(50).safeParse(req.body);
  if (!headers.success) throw AppError.badRequest(headers.error.message);

  await db.transaction(async (tx) => {
    await tx.delete(siteCustomHeadersTable).where(eq(siteCustomHeadersTable.siteId, siteId));
    if (headers.data.length > 0) {
      await tx.insert(siteCustomHeadersTable).values(headers.data.map(h => ({ siteId, ...h })));
    }
  });

  const updated = await db.select().from(siteCustomHeadersTable)
    .where(eq(siteCustomHeadersTable.siteId, siteId));

  invalidateSiteCache(siteId);
  res.json(updated);
}));

router.delete("/sites/:id/headers/:headerId", writeLimiter, asyncHandler(async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();
  const siteId   = parseInt(req.params.id as string, 10);
  const headerId = parseInt(req.params.headerId as string, 10);
  if (isNaN(siteId) || isNaN(headerId)) throw AppError.badRequest("Invalid ID");
  await requireSiteOwner(siteId, req.user.id);

  await db.delete(siteCustomHeadersTable).where(
    and(eq(siteCustomHeadersTable.id, headerId), eq(siteCustomHeadersTable.siteId, siteId))
  );
  invalidateSiteCache(siteId);
  res.sendStatus(204);
}));

export default router;
