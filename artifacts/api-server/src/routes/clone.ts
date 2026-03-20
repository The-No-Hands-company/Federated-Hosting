/**
 * Site cloning — duplicate an existing site under a new domain.
 *
 * Creates a new site record, copies all files from the latest active deployment
 * by reusing the same objectPaths (no storage duplication), and creates an
 * active deployment for the new site.
 *
 * Also copies: redirect rules, custom headers, env vars.
 * Does NOT copy: team members, custom domains, analytics, form submissions.
 *
 * Route:
 *   POST /api/sites/:id/clone
 *   Body: { name: string, domain: string, environment?: string }
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod/v4";
import { db, sitesTable, siteFilesTable, siteDeploymentsTable,
         siteRedirectRulesTable, siteCustomHeadersTable, siteEnvVarsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { asyncHandler, AppError } from "../lib/errors";
import { writeLimiter } from "../middleware/rateLimiter";

const router: IRouter = Router();

const CloneBody = z.object({
  name:        z.string().min(1).max(100),
  domain:      z.string().min(1).max(253).regex(/^[a-z0-9.-]+$/, "Domain must be lowercase with hyphens/dots"),
  environment: z.enum(["production", "staging", "preview"]).default("production"),
});

router.post("/sites/:id/clone", writeLimiter, asyncHandler(async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();

  const sourceId = parseInt(req.params.id as string, 10);
  if (isNaN(sourceId)) throw AppError.badRequest("Invalid site ID");

  const [source] = await db.select().from(sitesTable).where(eq(sitesTable.id, sourceId));
  if (!source) throw AppError.notFound("Source site not found");
  if (source.ownerId !== req.user.id) throw AppError.forbidden("Only the site owner can clone a site");

  const parsed = CloneBody.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest(parsed.error.message);

  const { name, domain, environment } = parsed.data;

  // Check domain not already in use
  const [existing] = await db.select({ id: sitesTable.id }).from(sitesTable).where(eq(sitesTable.domain, domain));
  if (existing) throw AppError.conflict(`Domain '${domain}' is already registered`);

  // Find active deployment of source
  const [activeDep] = await db.select()
    .from(siteDeploymentsTable)
    .where(and(eq(siteDeploymentsTable.siteId, sourceId), eq(siteDeploymentsTable.status, "active")))
    .orderBy(desc(siteDeploymentsTable.version))
    .limit(1);

  const sourceFiles = activeDep
    ? await db.select().from(siteFilesTable)
        .where(and(eq(siteFilesTable.siteId, sourceId), eq(siteFilesTable.deploymentId, activeDep.id)))
    : [];

  // Create new site + deployment in a transaction
  const { newSite, newDep } = await db.transaction(async (tx) => {
    const [newSite] = await tx.insert(sitesTable).values({
      name,
      domain,
      description:  source.description ? `Clone of ${source.name}: ${source.description}` : `Clone of ${source.name}`,
      siteType:     source.siteType,
      ownerId:      req.user.id,
      ownerName:    req.user.firstName ?? req.user.email ?? "",
      ownerEmail:   req.user.email ?? "",
      primaryNodeId: source.primaryNodeId,
      storageUsedMb: source.storageUsedMb,
      visibility:   "public",
    }).returning();

    const [newDep] = await tx.insert(siteDeploymentsTable).values({
      siteId:     newSite.id,
      version:    1,
      deployedBy: `clone:${sourceId}`,
      environment,
      status:     "active",
      fileCount:  sourceFiles.length,
      totalSizeMb: activeDep?.totalSizeMb ?? 0,
    }).returning();

    // Copy files — reuse objectPaths so no new storage is used
    if (sourceFiles.length > 0) {
      await tx.insert(siteFilesTable).values(
        sourceFiles.map(f => ({
          siteId:      newSite.id,
          filePath:    f.filePath,
          objectPath:  f.objectPath, // shared — content dedup means no extra storage
          contentType: f.contentType,
          sizeBytes:   f.sizeBytes,
          contentHash: f.contentHash,
          deploymentId: newDep.id,
        }))
      );
    }

    return { newSite, newDep };
  });

  // Copy redirect rules, custom headers, env vars (outside transaction for cleanliness)
  const [redirectRules, customHeaders, envVars] = await Promise.all([
    db.select().from(siteRedirectRulesTable).where(eq(siteRedirectRulesTable.siteId, sourceId)),
    db.select().from(siteCustomHeadersTable).where(eq(siteCustomHeadersTable.siteId, sourceId)),
    db.select().from(siteEnvVarsTable).where(eq(siteEnvVarsTable.siteId, sourceId)),
  ]);

  await Promise.all([
    redirectRules.length > 0 && db.insert(siteRedirectRulesTable).values(
      redirectRules.map(({ id: _, siteId: __, createdAt: ___, ...r }) => ({ ...r, siteId: newSite.id }))
    ),
    customHeaders.length > 0 && db.insert(siteCustomHeadersTable).values(
      customHeaders.map(({ id: _, siteId: __, createdAt: ___, ...h }) => ({ ...h, siteId: newSite.id }))
    ),
    envVars.length > 0 && db.insert(siteEnvVarsTable).values(
      envVars.map(({ id: _, siteId: __, createdAt: ___, ...e }) => ({ ...e, siteId: newSite.id }))
    ),
  ].filter(Boolean));

  res.status(201).json({
    site: newSite,
    deployment: newDep,
    filesCloned: sourceFiles.length,
    configCloned: {
      redirectRules: redirectRules.length,
      customHeaders: customHeaders.length,
      envVars: envVars.length,
    },
    message: `Site cloned successfully. ${sourceFiles.length} files copied (no extra storage used).`,
  });
}));

export default router;
