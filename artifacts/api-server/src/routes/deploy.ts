import { Router, type IRouter, type Request, type Response } from "express";
import { db, sitesTable, siteDeploymentsTable, siteFilesTable, nodesTable, federationEventsTable } from "@workspace/db";
import { eq, and, isNull, count, sql } from "drizzle-orm";
import { storage, ObjectNotFoundError } from "../lib/storageProvider";
import { signMessage } from "../lib/federation";
import { asyncHandler, AppError } from "../lib/errors";
import { uploadLimiter } from "../middleware/rateLimiter";
import { webhookDeploy, webhookDeployFailed } from "../lib/webhooks";
import { invalidateSiteCache } from "../lib/domainCache";
import { enqueueSyncRetry } from "../lib/syncRetryQueue";
import {
  GetSiteFileUploadUrlBody,
  RegisterSiteFileBody,
} from "@workspace/api-zod";
import logger from "../lib/logger";
import path from "path";

const router: IRouter = Router();

const ALLOWED_CONTENT_TYPES = new Set([
  "text/html", "text/css", "text/javascript", "application/javascript",
  "application/json", "image/png", "image/jpeg", "image/gif", "image/svg+xml",
  "image/webp", "image/ico", "image/x-icon", "font/woff", "font/woff2",
  "font/ttf", "application/font-woff", "application/font-woff2",
  "application/octet-stream", "text/plain", "application/xml", "text/xml",
]);

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB per file
const MAX_TOTAL_DEPLOY_SIZE_MB = 500; // 500 MB per deployment

function sanitizeFilePath(filePath: string): string {
  const normalized = path.normalize(filePath).replace(/^(\.\.(\/|\\|$))+/, "");
  return normalized.replace(/^\/+/, "");
}

router.post("/sites/:id/files/upload-url", uploadLimiter, asyncHandler(async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();

  const siteId = parseInt(req.params.id as string, 10);
  if (Number.isNaN(siteId)) throw AppError.badRequest("Invalid site ID");

  const parsed = GetSiteFileUploadUrlBody.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest(parsed.error.message);

  const [site] = await db.select().from(sitesTable).where(eq(sitesTable.id, siteId));
  if (!site) throw AppError.notFound("Site not found");

  const { filePath, contentType, size } = parsed.data;

  if (size && size > MAX_FILE_SIZE_BYTES) {
    throw AppError.badRequest(`File too large. Maximum size is ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB`, "FILE_TOO_LARGE");
  }

  const sanitized = sanitizeFilePath(filePath);
  if (!sanitized) throw AppError.badRequest("Invalid file path");

  const { uploadUrl, objectPath } = await storage.getUploadUrl({ contentType: contentType ?? "application/octet-stream", ttlSec: 900 });

  res.json({ uploadUrl, objectPath, filePath: sanitized });
}));

router.post("/sites/:id/files", asyncHandler(async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();

  const siteId = parseInt(req.params.id as string, 10);
  if (Number.isNaN(siteId)) throw AppError.badRequest("Invalid site ID");

  const parsed = RegisterSiteFileBody.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest(parsed.error.message);

  const [site] = await db.select().from(sitesTable).where(eq(sitesTable.id, siteId));
  if (!site) throw AppError.notFound("Site not found");

  const { filePath, objectPath, contentType, sizeBytes } = parsed.data;

  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    throw AppError.badRequest(`Content type '${contentType}' is not allowed`, "DISALLOWED_CONTENT_TYPE");
  }

  const sanitized = sanitizeFilePath(filePath);

  const [file] = await db
    .insert(siteFilesTable)
    .values({ siteId, filePath: sanitized, objectPath, contentType, sizeBytes })
    .returning();

  res.status(201).json(file);
}));

router.get("/sites/:id/files", asyncHandler(async (req: Request, res: Response) => {
  const siteId = parseInt(req.params.id as string, 10);
  if (Number.isNaN(siteId)) throw AppError.badRequest("Invalid site ID");

  const files = await db
    .select()
    .from(siteFilesTable)
    .where(eq(siteFilesTable.siteId, siteId));

  res.json(files);
}));

router.post("/sites/:id/deploy", asyncHandler(async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();

  const siteId = parseInt(req.params.id as string, 10);
  if (Number.isNaN(siteId)) throw AppError.badRequest("Invalid site ID");

  const [site] = await db.select().from(sitesTable).where(eq(sitesTable.id, siteId));
  if (!site) throw AppError.notFound("Site not found");

  const pendingFiles = await db
    .select()
    .from(siteFilesTable)
    .where(and(eq(siteFilesTable.siteId, siteId), isNull(siteFilesTable.deploymentId)));

  if (pendingFiles.length === 0) {
    throw AppError.badRequest("No files to deploy. Upload files first.", "NO_FILES");
  }

  const totalSizeMb = pendingFiles.reduce((acc, f) => acc + f.sizeBytes / (1024 * 1024), 0);

  if (totalSizeMb > MAX_TOTAL_DEPLOY_SIZE_MB) {
    throw AppError.badRequest(
      `Deployment too large (${totalSizeMb.toFixed(1)}MB). Maximum is ${MAX_TOTAL_DEPLOY_SIZE_MB}MB`,
      "DEPLOYMENT_TOO_LARGE",
    );
  }

  // Wrap entire deployment in a transaction for atomicity
  const deployment = await db.transaction(async (tx) => {
    const [{ depCount }] = await tx
      .select({ depCount: count() })
      .from(siteDeploymentsTable)
      .where(eq(siteDeploymentsTable.siteId, siteId));

    const [dep] = await tx
      .insert(siteDeploymentsTable)
      .values({
        siteId,
        version: Number(depCount) + 1,
        deployedBy: req.user.id,
        status: "active",
        fileCount: pendingFiles.length,
        totalSizeMb,
      })
      .returning();

    await tx
      .update(siteFilesTable)
      .set({ deploymentId: dep.id })
      .where(and(eq(siteFilesTable.siteId, siteId), isNull(siteFilesTable.deploymentId)));

    await tx
      .update(sitesTable)
      .set({ storageUsedMb: totalSizeMb, ownerId: req.user.id })
      .where(eq(sitesTable.id, siteId));

    return dep;
  });

  logger.info(
    { siteId, deploymentId: deployment.id, fileCount: pendingFiles.length, sizeMb: totalSizeMb },
    "Site deployed",
  );

  // Fire deploy webhook (non-blocking)
  webhookDeploy({
    siteId,
    siteDomain: site.domain,
    deploymentId: deployment.id,
    version: deployment.version,
    fileCount: pendingFiles.length,
  });

  // Invalidate host router cache so new files are served immediately
  invalidateSiteCache(siteId);

  // Replicate to federation peers (non-blocking — don't fail the deploy if peers are down)
  const [localNode] = await db.select().from(nodesTable).where(eq(nodesTable.isLocalNode, 1));
  const activePeers = await db
    .select()
    .from(nodesTable)
    .where(and(eq(nodesTable.status, "active"), eq(nodesTable.isLocalNode, 0)));

  const replicationResults: Array<{ node: string; success: boolean; error?: string }> = [];

  await Promise.allSettled(
    activePeers.map(async (peer) => {
      const peerUrl = peer.domain.startsWith("http") ? peer.domain : `https://${peer.domain}`;
      const timestamp = Date.now().toString();
      const payload = JSON.stringify({ siteDomain: site.domain, deploymentId: deployment.id, timestamp });
      const signature = localNode?.privateKey ? signMessage(localNode.privateKey, payload) : null;

      try {
        const syncRes = await fetch(`${peerUrl}/api/federation/sync`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(signature ? { "X-Federation-Signature": signature } : {}),
            ...(localNode?.domain ? { "X-Federation-From": localNode.domain } : {}),
          },
          body: payload,
          signal: AbortSignal.timeout(5000),
        });

        replicationResults.push({ node: peer.domain, success: syncRes.ok });

        if (!syncRes.ok) {
          enqueueSyncRetry({ siteDomain: site.domain, deploymentId: deployment.id, targetNodeDomain: peer.domain, error: `HTTP ${syncRes.status}` });
        }

        await db.insert(federationEventsTable).values({
          eventType: "site_sync",
          fromNodeDomain: localNode?.domain ?? "local",
          toNodeDomain: peer.domain,
          payload: JSON.stringify({ siteDomain: site.domain, deploymentId: deployment.id }),
          verified: syncRes.ok ? 1 : 0,
        });
      } catch (err: any) {
        replicationResults.push({ node: peer.domain, success: false, error: err.message });
        logger.warn({ peer: peer.domain, err: err.message }, "Replication to peer failed — queued for retry");
        enqueueSyncRetry({ siteDomain: site.domain, deploymentId: deployment.id, targetNodeDomain: peer.domain, error: err.message });
      }
    }),
  );

  res.json({
    ...deployment,
    replication: {
      peers: activePeers.length,
      synced: replicationResults.filter((r) => r.success).length,
      results: replicationResults,
    },
  });
}));

router.get("/sites/:id/deployments", asyncHandler(async (req: Request, res: Response) => {
  const siteId = parseInt(req.params.id as string, 10);
  if (Number.isNaN(siteId)) throw AppError.badRequest("Invalid site ID");

  const deployments = await db
    .select()
    .from(siteDeploymentsTable)
    .where(eq(siteDeploymentsTable.siteId, siteId))
    .orderBy(siteDeploymentsTable.createdAt);

  res.json(deployments);
}));

/**
 * POST /api/sites/:id/deployments/:depId/rollback
 *
 * Rolls back a site to a specific previous deployment.
 * Creates a NEW deployment record pointing to the same files as the target,
 * so the history is preserved and the rollback itself is auditable.
 */
router.post("/sites/:id/deployments/:depId/rollback", writeLimiter, asyncHandler(async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();

  const siteId = parseInt(req.params.id as string, 10);
  const depId  = parseInt(req.params.depId as string, 10);
  if (Number.isNaN(siteId) || Number.isNaN(depId)) throw AppError.badRequest("Invalid ID");

  const [site] = await db.select().from(sitesTable).where(eq(sitesTable.id, siteId));
  if (!site) throw AppError.notFound("Site not found");
  if (site.ownerId !== req.user.id) throw AppError.forbidden("Only the site owner can rollback deployments");

  const [targetDep] = await db
    .select()
    .from(siteDeploymentsTable)
    .where(and(eq(siteDeploymentsTable.id, depId), eq(siteDeploymentsTable.siteId, siteId)));
  if (!targetDep) throw AppError.notFound("Deployment not found");

  // Get the files from the target deployment
  const targetFiles = await db
    .select()
    .from(siteFilesTable)
    .where(eq(siteFilesTable.deploymentId, depId));

  if (targetFiles.length === 0) throw AppError.badRequest("Target deployment has no files");

  const newDeployment = await db.transaction(async (tx) => {
    // Mark the current active deployment as rolled_back
    await tx
      .update(siteDeploymentsTable)
      .set({ status: "rolled_back" })
      .where(and(eq(siteDeploymentsTable.siteId, siteId), eq(siteDeploymentsTable.status, "active")));

    const [{ depCount }] = await tx
      .select({ depCount: count() })
      .from(siteDeploymentsTable)
      .where(eq(siteDeploymentsTable.siteId, siteId));

    const totalSizeMb = targetFiles.reduce((s, f) => s + f.sizeBytes / (1024 * 1024), 0);

    // Create a new deployment (rollback is a forward operation — no time travel)
    const [newDep] = await tx
      .insert(siteDeploymentsTable)
      .values({
        siteId,
        version: Number(depCount) + 1,
        deployedBy: req.user.id,
        status: "active",
        fileCount: targetFiles.length,
        totalSizeMb,
      })
      .returning();

    // Re-point all the target files at the new deployment
    // We insert copies so the history of the old deployment remains intact
    await tx.insert(siteFilesTable).values(
      targetFiles.map((f) => ({
        siteId,
        deploymentId: newDep.id,
        filePath: f.filePath,
        objectPath: f.objectPath,
        contentType: f.contentType,
        sizeBytes: f.sizeBytes,
      })),
    );

    await tx
      .update(sitesTable)
      .set({ storageUsedMb: totalSizeMb })
      .where(eq(sitesTable.id, siteId));

    return newDep;
  });

  logger.info({ siteId, targetDepId: depId, newDepId: newDeployment.id }, "Site rolled back");
  res.json({ ...newDeployment, rolledBackFrom: depId });
}));

router.get("/sites/serve/:domain/*filePath", asyncHandler(async (req: Request, res: Response) => {
  const domain = req.params.domain as string;
  const rawPath = req.params.filePath as string;
  const filePath = Array.isArray(rawPath) ? rawPath.join("/") : (rawPath || "index.html");
  const resolvedPath = sanitizeFilePath(filePath) || "index.html";

  const [site] = await db.select().from(sitesTable).where(eq(sitesTable.domain, domain));
  if (!site) {
    res.status(404).send("<!DOCTYPE html><html><body><h1>Site not found</h1><p>No site is registered for this domain.</p></body></html>");
    return;
  }

  const serveFile = async (fp: string): Promise<boolean> => {
    const [fileRecord] = await db
      .select()
      .from(siteFilesTable)
      .where(and(eq(siteFilesTable.siteId, site.id), eq(siteFilesTable.filePath, fp)));

    if (!fileRecord) return false;

    try {
      res.setHeader("Content-Type", fileRecord.contentType);
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.setHeader("X-Served-By", "federated-hosting");
      res.setHeader("X-Site-Domain", site.domain);

      await storage.streamToResponse(fileRecord.objectPath, res);
      // Fire-and-forget: increment hit counter (never block the response)
      db.update(sitesTable)
        .set({ hitCount: sql`${sitesTable.hitCount} + 1`, lastHitAt: new Date() })
        .where(eq(sitesTable.id, site.id))
        .catch(() => { /* ignore tracking errors */ });
      return true;
    } catch (err) {
      if (err instanceof ObjectNotFoundError) return false;
      throw err;
    }
  };

  const found = await serveFile(resolvedPath);
  if (!found && resolvedPath !== "index.html") {
    const indexFound = await serveFile("index.html");
    if (!indexFound) {
      res.status(404).send("<!DOCTYPE html><html><body><h1>404</h1><p>Page not found.</p></body></html>");
    }
    return;
  }
  if (!found) {
    res.status(404).send("<!DOCTYPE html><html><body><h1>404</h1><p>This site has no index.html yet.</p></body></html>");
  }
}));

export default router;
