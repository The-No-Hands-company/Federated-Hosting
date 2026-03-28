import { Router, type IRouter, type Request, type Response } from "express";
import { db, customDomainsTable, sitesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { asyncHandler, AppError } from "../lib/errors";
import { writeLimiter } from "../middleware/rateLimiter";
import { z } from "zod/v4";
import dns from "dns/promises";
import crypto from "crypto";
import logger from "../lib/logger";

const router: IRouter = Router();

const AddDomainBody = z.object({
  domain: z.string().min(3).max(253).regex(/^[a-z0-9.-]+$/, "Invalid domain format"),
});

function generateVerificationToken(): string {
  return `fhv_${crypto.randomBytes(12).toString("hex")}`;
}

/** GET /api/sites/:id/domains */
router.get("/sites/:id/domains", asyncHandler(async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();
  const siteId = parseInt(req.params.id as string, 10);
  if (Number.isNaN(siteId)) throw AppError.badRequest("Invalid site ID");

  const [site] = await db.select({ ownerId: sitesTable.ownerId }).from(sitesTable).where(eq(sitesTable.id, siteId));
  if (!site) throw AppError.notFound("Site not found");
  if (site.ownerId !== req.user.id) throw AppError.forbidden();

  const domains = await db.select().from(customDomainsTable).where(eq(customDomainsTable.siteId, siteId));
  res.json(domains);
}));

/** POST /api/sites/:id/domains — add a custom domain */
router.post("/sites/:id/domains", writeLimiter, asyncHandler(async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();
  const siteId = parseInt(req.params.id as string, 10);
  if (Number.isNaN(siteId)) throw AppError.badRequest("Invalid site ID");

  const [site] = await db.select({ ownerId: sitesTable.ownerId }).from(sitesTable).where(eq(sitesTable.id, siteId));
  if (!site) throw AppError.notFound("Site not found");
  if (site.ownerId !== req.user.id) throw AppError.forbidden();

  const parsed = AddDomainBody.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest(parsed.error.message);

  const { domain } = parsed.data;

  const [existing] = await db.select({ id: customDomainsTable.id }).from(customDomainsTable)
    .where(eq(customDomainsTable.domain, domain));
  if (existing) throw AppError.conflict(`Domain '${domain}' is already registered`);

  const verificationToken = generateVerificationToken();

  const [row] = await db.insert(customDomainsTable).values({
    siteId,
    domain,
    verificationToken,
    status: "pending",
  }).returning();

  res.status(201).json({
    ...row,
    instructions: {
      txt: {
        name: `_fh-verify.${domain}`,
        type: "TXT",
        value: verificationToken,
      },
      cname: {
        name: domain,
        type: "CNAME",
        value: process.env.PUBLIC_DOMAIN ?? "nodes.nexushosting.network",
      },
    },
  });
}));

/** POST /api/domains/:id/verify — trigger DNS verification check */
router.post("/domains/:id/verify", asyncHandler(async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();
  const id = parseInt(req.params.id as string, 10);
  if (Number.isNaN(id)) throw AppError.badRequest("Invalid domain ID");

  const [row] = await db.select().from(customDomainsTable).where(eq(customDomainsTable.id, id));
  if (!row) throw AppError.notFound("Domain not found");

  // Verify the site belongs to the caller
  const [site] = await db.select({ ownerId: sitesTable.ownerId }).from(sitesTable).where(eq(sitesTable.id, row.siteId));
  if (!site || site.ownerId !== req.user.id) throw AppError.forbidden();

  const now = new Date();
  let verified = false;
  let lastError: string | null = null;

  try {
    const txtRecords = await dns.resolveTxt(`_fh-verify.${row.domain}`);
    const flat = txtRecords.flat();
    verified = flat.includes(row.verificationToken);

    if (!verified) {
      lastError = `TXT record not found. Expected '_fh-verify.${row.domain}' to contain: ${row.verificationToken}`;
    }
  } catch (err: any) {
    lastError = `DNS lookup failed: ${err.message}`;
    logger.warn({ domain: row.domain, err: err.message }, "Custom domain DNS check failed");
  }

  const [updated] = await db
    .update(customDomainsTable)
    .set({
      status: verified ? "verified" : "failed",
      verifiedAt: verified ? now : null,
      lastCheckedAt: now,
      lastError: verified ? null : lastError,
      updatedAt: now,
    })
    .where(eq(customDomainsTable.id, id))
    .returning();

  res.json({ verified, domain: row.domain, status: updated.status, lastError });
}));

/** DELETE /api/domains/:id */
router.delete("/domains/:id", writeLimiter, asyncHandler(async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();
  const id = parseInt(req.params.id as string, 10);
  if (Number.isNaN(id)) throw AppError.badRequest("Invalid domain ID");

  const [row] = await db.select().from(customDomainsTable).where(eq(customDomainsTable.id, id));
  if (!row) throw AppError.notFound("Domain not found");

  const [site] = await db.select({ ownerId: sitesTable.ownerId }).from(sitesTable).where(eq(sitesTable.id, row.siteId));
  if (!site || site.ownerId !== req.user.id) throw AppError.forbidden();

  await db.delete(customDomainsTable).where(eq(customDomainsTable.id, id));
  res.sendStatus(204);
}));

export default router;
