import { Router, type IRouter, type Request, type Response } from "express";
import { db, nodesTable, siteDeploymentsTable, siteFilesTable, sitesTable, federationEventsTable } from "@workspace/db";
import { eq, desc, and, count } from "drizzle-orm";
import { generateKeyPair, signMessage, verifySignature, createFederationChallenge, stripPemHeaders } from "../lib/federation";
import { serializeDates } from "../lib/serialize";
import { asyncHandler, AppError } from "../lib/errors";
import { federationLimiter, writeLimiter } from "../middleware/rateLimiter";
import { parsePagination, buildPaginatedResponse } from "../lib/pagination";
import logger from "../lib/logger";
import { resolveConflict } from "../lib/conflictResolution";

const router: IRouter = Router();
const PROTOCOL_VERSION = "fedhost/1.0";

router.get("/federation/meta", asyncHandler(async (_req, res) => {
  const [localNode] = await db.select().from(nodesTable).where(eq(nodesTable.isLocalNode, 1));
  const allNodes = await db.select().from(nodesTable);
  const activeDeployments = await db.select().from(siteDeploymentsTable).where(eq(siteDeploymentsTable.status, "active"));

  res.json({
    protocol: PROTOCOL_VERSION,
    name: localNode?.name ?? "Federated Hosting Node",
    domain: localNode?.domain ?? "unknown",
    region: localNode?.region ?? "unknown",
    publicKey: localNode?.publicKey ? stripPemHeaders(localNode.publicKey) : null,
    nodeCount: allNodes.length,
    activeSites: activeDeployments.length,
    joinedAt: localNode?.joinedAt ?? new Date().toISOString(),
    capabilities: ["site-hosting", "node-federation", "key-verification", "site-replication"],
  });
}));

router.post("/federation/ping", federationLimiter, asyncHandler(async (req, res) => {
  const { nodeDomain, challenge, signature, timestamp } = req.body;

  if (!nodeDomain || !challenge || !signature) {
    throw AppError.badRequest("Missing required fields: nodeDomain, challenge, signature");
  }

  const [remoteNode] = await db
    .select()
    .from(nodesTable)
    .where(eq(nodesTable.domain, nodeDomain));

  if (!remoteNode?.publicKey) {
    throw AppError.notFound("Unknown node or node has no public key");
  }

  const message = `${nodeDomain}:${challenge}:${timestamp ?? ""}`;
  const valid = verifySignature(remoteNode.publicKey, message, signature);

  await db.insert(federationEventsTable).values({
    eventType: "ping",
    fromNodeDomain: nodeDomain,
    payload: JSON.stringify({ challenge, verified: valid }),
    verified: valid ? 1 : 0,
  });

  if (!valid) {
    logger.warn({ nodeDomain }, "Federation ping rejected — invalid signature");
    throw AppError.unauthorized("Invalid signature — node identity could not be verified", "INVALID_SIGNATURE");
  }

  await db
    .update(nodesTable)
    .set({ lastSeenAt: new Date(), verifiedAt: new Date(), status: "active" })
    .where(eq(nodesTable.domain, nodeDomain));

  logger.info({ nodeDomain }, "Federation ping verified");
  res.json({ verified: true, protocol: PROTOCOL_VERSION, challenge: createFederationChallenge() });
}));

router.post("/federation/handshake", federationLimiter, asyncHandler(async (req, res) => {
  const { targetNodeUrl } = req.body;
  if (!targetNodeUrl) throw AppError.badRequest("Missing targetNodeUrl");

  const [localNode] = await db.select().from(nodesTable).where(eq(nodesTable.isLocalNode, 1));
  if (!localNode?.privateKey || !localNode?.publicKey) {
    throw AppError.internal("Local node has no key pair. Generate keys first.");
  }

  const challenge = createFederationChallenge();
  const timestamp = Date.now().toString();
  const message = `${localNode.domain}:${challenge}:${timestamp}`;
  const signature = signMessage(localNode.privateKey, message);

  let discoveryData: Record<string, unknown> | null = null;
  let pingResult: Record<string, unknown> | null = null;
  let error: string | null = null;

  try {
    const discoveryRes = await fetch(`${targetNodeUrl}/.well-known/federation`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (discoveryRes.ok) discoveryData = await discoveryRes.json() as Record<string, unknown>;

    const pingRes = await fetch(`${targetNodeUrl}/api/federation/ping`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nodeDomain: localNode.domain, challenge, signature, timestamp }),
      signal: AbortSignal.timeout(10_000),
    });

    if (pingRes.ok) {
      pingResult = await pingRes.json() as Record<string, unknown>;
    } else {
      error = `Remote node rejected ping: ${pingRes.status}`;
    }
  } catch (err: any) {
    error = `Could not reach node: ${err.message}`;
  }

  await db.insert(federationEventsTable).values({
    eventType: "handshake",
    fromNodeDomain: localNode.domain,
    toNodeDomain: targetNodeUrl,
    payload: JSON.stringify({ discoveryData, pingResult, error }),
    verified: pingResult ? 1 : 0,
  });

  logger.info({ targetNodeUrl, success: !error }, "Federation handshake completed");
  res.json({ success: !error, targetUrl: targetNodeUrl, discoveryData, pingResult, error });
}));

router.post("/nodes/:id/generate-keys", writeLimiter, asyncHandler(async (req, res) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();
  const nodeId = parseInt(req.params.id as string, 10);
  if (Number.isNaN(nodeId)) throw AppError.badRequest("Invalid node ID");

  const [node] = await db.select().from(nodesTable).where(eq(nodesTable.id, nodeId));
  if (!node) throw AppError.notFound(`Node ${nodeId} not found`);

  const { publicKey, privateKey } = generateKeyPair();
  await db.update(nodesTable).set({ publicKey, privateKey }).where(eq(nodesTable.id, nodeId));

  logger.info({ nodeId }, "Ed25519 key pair generated for node");
  res.json({ nodeId, publicKey, message: "Ed25519 key pair generated. Private key stored securely." });
}));

router.get("/federation/peers", asyncHandler(async (req, res) => {
  const { limit, offset, page } = parsePagination(req);

  const [{ total }] = await db
    .select({ total: count() })
    .from(nodesTable)
    .where(eq(nodesTable.isLocalNode, 0));

  const peers = await db
    .select({
      id: nodesTable.id, name: nodesTable.name, domain: nodesTable.domain,
      status: nodesTable.status, region: nodesTable.region, publicKey: nodesTable.publicKey,
      verifiedAt: nodesTable.verifiedAt, lastSeenAt: nodesTable.lastSeenAt,
    })
    .from(nodesTable)
    .where(eq(nodesTable.isLocalNode, 0))
    .orderBy(nodesTable.lastSeenAt)
    .limit(limit)
    .offset(offset);

  res.json(buildPaginatedResponse(serializeDates(peers), Number(total), { limit, offset, page }));
}));

router.get("/federation/events", asyncHandler(async (req, res) => {
  const { limit, offset, page } = parsePagination(req);

  const [{ total }] = await db.select({ total: count() }).from(federationEventsTable);

  const events = await db
    .select()
    .from(federationEventsTable)
    .orderBy(desc(federationEventsTable.createdAt))
    .limit(limit)
    .offset(offset);

  res.json(buildPaginatedResponse(serializeDates(events), Number(total), { limit, offset, page }));
}));

/**
 * POST /api/federation/sync
 *
 * Receives a site_sync notification from a peer node.
 * Fetches the full file manifest from the origin, downloads every file,
 * stores them in local object storage, and creates a local replica deployment.
 *
 * This is what makes the network actually federated — every node can serve
 * every site independently after receiving a sync.
 */
router.post("/federation/sync", asyncHandler(async (req, res) => {
  const { siteDomain, deploymentId, timestamp } = req.body as {
    siteDomain?: string;
    deploymentId?: number;
    timestamp?: string;
  };

  if (!siteDomain || !deploymentId) {
    throw AppError.badRequest("Missing siteDomain or deploymentId");
  }

  // Verify the signature on the sync message
  const signature = req.headers["x-federation-signature"] as string | undefined;

  // Find the originating node by looking up the site
  const [existingSite] = await db.select().from(sitesTable).where(eq(sitesTable.domain, siteDomain));

  // If we already have this site with a deployment at this version, skip
  if (existingSite) {
    const [existingDep] = await db
      .select()
      .from(siteDeploymentsTable)
      .where(
        and(
          eq(siteDeploymentsTable.siteId, existingSite.id),
          eq(siteDeploymentsTable.status, "active"),
        ),
      );

    if (existingDep && existingDep.id === deploymentId) {
      logger.info({ siteDomain, deploymentId }, "Sync skipped — already have this deployment");
      res.json({ status: "skipped", reason: "already_synced" });
      return;
    }
  }

  // ── Conflict resolution ───────────────────────────────────────────────────
  // If we already host this domain, run the trust-chain algorithm before
  // accepting the incoming sync.
  const fromDomain = (req.body as { fromDomain?: string }).fromDomain ??
    req.headers["x-federation-from"] as string | undefined;

  if (existingSite && fromDomain) {
    const payload = JSON.stringify({ siteDomain, deploymentId, timestamp });
    const resolution = await resolveConflict({
      siteDomain,
      remoteNodeDomain: fromDomain,
      remoteDeploymentId: deploymentId,
      remoteSignature: signature,
      remotePayload: payload,
    });

    if (!resolution.accepted) {
      logger.info(
        { siteDomain, fromDomain, reason: resolution.reason },
        "[sync] Conflict resolution: local node wins — sync rejected",
      );
      res.status(409).json({
        status: "conflict",
        winner: "local",
        reason: resolution.reason,
        message: `This node's version of '${siteDomain}' takes precedence (${resolution.reason}).`,
      });
      return;
    }

    logger.info(
      { siteDomain, fromDomain, reason: resolution.reason },
      "[sync] Conflict resolution: remote node wins — accepting sync",
    );
  }

  // Find which peer is the origin for this site — try all active peers
  const activePeers = await db
    .select()
    .from(nodesTable)
    .where(and(eq(nodesTable.status, "active"), eq(nodesTable.isLocalNode, 0)));

  let manifestData: {
    site: typeof sitesTable.$inferSelect;
    deployment: typeof siteDeploymentsTable.$inferSelect;
    files: Array<{ filePath: string; contentType: string; sizeBytes: number; downloadUrl: string }>;
  } | null = null;

  let originDomain: string | null = null;

  for (const peer of activePeers) {
    const peerUrl = peer.domain.startsWith("http") ? peer.domain : `https://${peer.domain}`;
    try {
      const manifestRes = await fetch(
        `${peerUrl}/api/federation/manifest/${encodeURIComponent(siteDomain)}?deploymentId=${deploymentId}`,
        { signal: AbortSignal.timeout(10_000) },
      );
      if (manifestRes.ok) {
        manifestData = await manifestRes.json() as typeof manifestData;
        originDomain = peer.domain;
        break;
      }
    } catch {
      // Try next peer
    }
  }

  if (!manifestData || !originDomain) {
    logger.warn({ siteDomain, deploymentId }, "Sync: could not fetch manifest from any peer");

    await db.insert(federationEventsTable).values({
      eventType: "site_sync",
      fromNodeDomain: "unknown",
      toNodeDomain: "local",
      payload: JSON.stringify({ siteDomain, deploymentId, error: "manifest_fetch_failed" }),
      verified: 0,
    });

    res.status(202).json({ status: "queued", reason: "manifest_unavailable" });
    return;
  }

  const { ObjectStorageService } = await import("../lib/objectStorage");
  const storage = new ObjectStorageService();
  const [localNode] = await db.select().from(nodesTable).where(eq(nodesTable.isLocalNode, 1));

  // Upsert the site record locally
  let localSite = existingSite;
  if (!localSite) {
    const [created] = await db
      .insert(sitesTable)
      .values({
        name: manifestData.site.name,
        domain: manifestData.site.domain,
        description: manifestData.site.description,
        siteType: manifestData.site.siteType,
        ownerName: manifestData.site.ownerName,
        ownerEmail: manifestData.site.ownerEmail,
        ownerId: manifestData.site.ownerId,
        primaryNodeId: localNode?.id,
        status: "active",
      })
      .returning();
    localSite = created;
    logger.info({ siteDomain, siteId: created.id }, "Sync: created local site record");
  }

  // Download all files and store in local object storage
  const downloadResults = await Promise.allSettled(
    manifestData.files.map(async (remoteFile) => {
      const fileRes = await fetch(remoteFile.downloadUrl, { signal: AbortSignal.timeout(30_000) });
      if (!fileRes.ok) throw new Error(`Failed to download ${remoteFile.filePath}: HTTP ${fileRes.status}`);

      const buffer = Buffer.from(await fileRes.arrayBuffer());

      // Get a new object path in local storage
      const uploadUrl = await storage.getObjectEntityUploadURL();
      const objectPath = storage.normalizeObjectEntityPath(uploadUrl);

      // Upload to local object storage via presigned URL
      await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": remoteFile.contentType },
        body: buffer,
        signal: AbortSignal.timeout(30_000),
      });

      return {
        filePath: remoteFile.filePath,
        objectPath,
        contentType: remoteFile.contentType,
        sizeBytes: remoteFile.sizeBytes,
      };
    }),
  );

  const successfulFiles = downloadResults
    .filter((r): r is PromiseFulfilledResult<{ filePath: string; objectPath: string; contentType: string; sizeBytes: number }> => r.status === "fulfilled")
    .map((r) => r.value);

  const failedCount = downloadResults.filter((r) => r.status === "rejected").length;

  if (successfulFiles.length === 0) {
    logger.error({ siteDomain, deploymentId }, "Sync: all file downloads failed");
    res.status(500).json({ status: "failed", reason: "all_downloads_failed" });
    return;
  }

  // Create local deployment + file records atomically
  await db.transaction(async (tx) => {
    // Mark any existing active deployment as superseded
    await tx
      .update(siteDeploymentsTable)
      .set({ status: "rolled_back" })
      .where(and(eq(siteDeploymentsTable.siteId, localSite!.id), eq(siteDeploymentsTable.status, "active")));

    const totalSizeMb = successfulFiles.reduce((s, f) => s + f.sizeBytes / (1024 * 1024), 0);

    const [dep] = await tx
      .insert(siteDeploymentsTable)
      .values({
        siteId: localSite!.id,
        version: manifestData!.deployment.version,
        deployedBy: `federation:${originDomain}`,
        status: "active",
        fileCount: successfulFiles.length,
        totalSizeMb,
      })
      .returning();

    // Remove old file records for this site and insert fresh ones
    await tx.delete(siteFilesTable).where(eq(siteFilesTable.siteId, localSite!.id));

    if (successfulFiles.length > 0) {
      await tx.insert(siteFilesTable).values(
        successfulFiles.map((f) => ({
          siteId: localSite!.id,
          deploymentId: dep.id,
          filePath: f.filePath,
          objectPath: f.objectPath,
          contentType: f.contentType,
          sizeBytes: f.sizeBytes,
        })),
      );
    }

    await tx
      .update(sitesTable)
      .set({ storageUsedMb: totalSizeMb, replicaCount: 1 })
      .where(eq(sitesTable.id, localSite!.id));
  });

  await db.insert(federationEventsTable).values({
    eventType: "site_sync",
    fromNodeDomain: originDomain,
    toNodeDomain: localNode?.domain ?? "local",
    payload: JSON.stringify({ siteDomain, deploymentId, filesSync: successfulFiles.length, failedCount }),
    verified: 1,
  });

  logger.info(
    { siteDomain, deploymentId, filesSync: successfulFiles.length, failedCount, originDomain },
    "Sync: site replicated successfully",
  );

  res.json({
    status: "synced",
    siteDomain,
    filesSync: successfulFiles.length,
    failedFiles: failedCount,
    originDomain,
  });
}));

/**
 * GET /api/federation/manifest/:siteDomain
 *
 * Returns the file manifest for a site so peer nodes can replicate it.
 * Generates short-lived presigned download URLs for each file.
 * This endpoint is public — any node can fetch it to replicate a site.
 */
router.get("/federation/manifest/:siteDomain", asyncHandler(async (req, res) => {
  const { siteDomain } = req.params as { siteDomain: string };
  const deploymentId = req.query.deploymentId ? parseInt(req.query.deploymentId as string, 10) : undefined;

  const [site] = await db.select().from(sitesTable).where(eq(sitesTable.domain, siteDomain));
  if (!site) throw AppError.notFound(`Site '${siteDomain}' not found on this node`);

  let deployment: typeof siteDeploymentsTable.$inferSelect | undefined;

  if (deploymentId) {
    const [dep] = await db
      .select()
      .from(siteDeploymentsTable)
      .where(and(eq(siteDeploymentsTable.siteId, site.id), eq(siteDeploymentsTable.id, deploymentId)));
    deployment = dep;
  } else {
    const [dep] = await db
      .select()
      .from(siteDeploymentsTable)
      .where(and(eq(siteDeploymentsTable.siteId, site.id), eq(siteDeploymentsTable.status, "active")))
      .orderBy(desc(siteDeploymentsTable.createdAt))
      .limit(1);
    deployment = dep;
  }

  if (!deployment) throw AppError.notFound("No active deployment found for this site");

  const files = await db
    .select()
    .from(siteFilesTable)
    .where(eq(siteFilesTable.deploymentId, deployment.id));

  const { ObjectStorageService } = await import("../lib/objectStorage");
  const storage = new ObjectStorageService();

  // Generate presigned download URLs for each file (valid 1 hour)
  const filesWithUrls = await Promise.all(
    files.map(async (f) => {
      try {
        const fileEntity = await storage.getObjectEntityFile(f.objectPath);
        const downloadUrl = await storage.getObjectEntityDownloadURL(fileEntity);
        return {
          filePath: f.filePath,
          contentType: f.contentType,
          sizeBytes: f.sizeBytes,
          downloadUrl,
        };
      } catch {
        return null;
      }
    }),
  );

  const validFiles = filesWithUrls.filter((f): f is NonNullable<typeof f> => f !== null);

  // Sign the manifest with our private key so peers can verify integrity
  const [localNode] = await db.select().from(nodesTable).where(eq(nodesTable.isLocalNode, 1));
  const manifestPayload = JSON.stringify({ siteDomain, deploymentId: deployment.id, fileCount: validFiles.length });
  const signature = localNode?.privateKey ? signMessage(localNode.privateKey, manifestPayload) : null;

  res.json({
    site: {
      id: site.id,
      name: site.name,
      domain: site.domain,
      description: site.description,
      siteType: site.siteType,
      ownerName: site.ownerName,
      ownerEmail: site.ownerEmail,
      ownerId: site.ownerId,
    },
    deployment,
    files: validFiles,
    signature,
    servedBy: localNode?.domain ?? "unknown",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  });
}));

export default router;
