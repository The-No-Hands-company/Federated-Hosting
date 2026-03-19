import { Router, type IRouter, type Request, type Response } from "express";
import { db, nodesTable, siteDeploymentsTable, siteFilesTable, sitesTable, federationEventsTable } from "@workspace/db";
import { eq, desc, and, count } from "drizzle-orm";
import { generateKeyPair, signMessage, verifySignature, createFederationChallenge, stripPemHeaders } from "../lib/federation";
import { serializeDates } from "../lib/serialize";
import { asyncHandler, AppError } from "../lib/errors";
import { federationLimiter } from "../middleware/rateLimiter";
import { parsePagination, buildPaginatedResponse } from "../lib/pagination";
import logger from "../lib/logger";

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

router.post("/nodes/:id/generate-keys", asyncHandler(async (req, res) => {
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

router.post("/federation/notify-sync", asyncHandler(async (req, res) => {
  const { siteId, deploymentId } = req.body;
  if (!siteId || !deploymentId) throw AppError.badRequest("Missing siteId or deploymentId");

  const [site] = await db.select().from(sitesTable).where(eq(sitesTable.id, siteId));
  if (!site) throw AppError.notFound("Site not found");

  const activeNodes = await db
    .select()
    .from(nodesTable)
    .where(and(eq(nodesTable.status, "active"), eq(nodesTable.isLocalNode, 0)));

  const results = await Promise.allSettled(
    activeNodes.map(async (node) => {
      const targetUrl = node.domain.startsWith("http") ? node.domain : `https://${node.domain}`;
      const syncRes = await fetch(`${targetUrl}/api/federation/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteDomain: site.domain, deploymentId }),
        signal: AbortSignal.timeout(5000),
      });
      await db.insert(federationEventsTable).values({
        eventType: "site_sync",
        fromNodeDomain: site.domain,
        toNodeDomain: node.domain,
        payload: JSON.stringify({ siteId, deploymentId }),
        verified: syncRes.ok ? 1 : 0,
      });
      return { node: node.domain, success: syncRes.ok };
    }),
  );

  const resolved = results.map((r, i) =>
    r.status === "fulfilled" ? r.value : { node: activeNodes[i].domain, success: false, error: (r.reason as Error)?.message },
  );

  res.json({
    synced: resolved.filter((r) => r.success).length,
    total: activeNodes.length,
    results: resolved,
  });
}));

export default router;
