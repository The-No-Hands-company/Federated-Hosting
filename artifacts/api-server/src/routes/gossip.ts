/**
 * Gossip peer discovery.
 *
 * Each node periodically pushes its known-peer list to all active peers.
 * Any node the remote knows about but the local node doesn't gets automatically
 * registered and probed for a handshake.
 *
 * API:
 *   GET  /api/federation/gossip          — our known peer list (public)
 *   POST /api/federation/gossip/push     — receive peers from a remote node
 *   POST /api/federation/gossip/discover — manually trigger a discover cycle
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, nodesTable, federationEventsTable } from "@workspace/db";
import { eq, and, ne, desc } from "drizzle-orm";
import { asyncHandler, AppError } from "../lib/errors";
import { signMessage, verifyMessage, generateKeyPair } from "../lib/federation";
import logger from "../lib/logger";
import { z } from "zod/v4";
import { webhookNewPeer } from "../lib/webhooks";
import { isBlocked } from "./federationBlocks";

const router: IRouter = Router();

const PeerInfo = z.object({
  domain: z.string().min(3),
  name: z.string().optional(),
  publicKey: z.string().optional(),
  region: z.string().optional(),
});

const GossipPushBody = z.object({
  fromDomain: z.string().min(3),
  peers: z.array(PeerInfo).max(100),
  timestamp: z.number(),
  signature: z.string().optional(),
});

/** GET /api/federation/gossip — return our peer list for other nodes to consume */
router.get("/federation/gossip", asyncHandler(async (_req: Request, res: Response) => {
  const [localNode] = await db.select().from(nodesTable).where(eq(nodesTable.isLocalNode, 1));

  const peers = await db
    .select({
      domain: nodesTable.domain,
      name: nodesTable.name,
      publicKey: nodesTable.publicKey,
      region: nodesTable.region,
      status: nodesTable.status,
      lastSeenAt: nodesTable.lastSeenAt,
    })
    .from(nodesTable)
    .where(and(eq(nodesTable.status, "active"), ne(nodesTable.isLocalNode, 1)));

  res.json({
    domain: localNode?.domain ?? "unknown",
    peerCount: peers.length,
    peers,
    servedAt: new Date().toISOString(),
  });
}));

/**
 * POST /api/federation/gossip/push
 * A remote node pushes its known peers to us.
 * We upsert any new domains we haven't seen before.
 */
router.post("/federation/gossip/push", asyncHandler(async (req: Request, res: Response) => {
  const parsed = GossipPushBody.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest(parsed.error.message);

  const { fromDomain, peers, timestamp } = parsed.data;

  // Reject gossip from blocked nodes
  if (isBlocked(fromDomain)) {
    logger.warn({ fromDomain }, "[gossip] Push rejected — sender is on blocklist");
    throw AppError.forbidden("This node is not permitted to federate with us.");
  }

  // Reject stale messages (older than 5 minutes)
  if (Math.abs(Date.now() - timestamp) > 5 * 60 * 1000) {
    throw AppError.badRequest("Gossip message timestamp is too old or in the future");
  }

  const [localNode] = await db.select().from(nodesTable).where(eq(nodesTable.isLocalNode, 1));
  const existingDomains = new Set(
    (await db.select({ domain: nodesTable.domain }).from(nodesTable)).map((n) => n.domain),
  );

  let newPeers = 0;
  const registered: string[] = [];

  for (const peer of peers) {
    // Don't register ourselves or already-known nodes
    if (peer.domain === localNode?.domain) continue;
    if (existingDomains.has(peer.domain)) continue;

    try {
      await db.insert(nodesTable).values({
        name: peer.name ?? peer.domain,
        domain: peer.domain,
        publicKey: peer.publicKey ?? "",
        privateKey: "",
        region: peer.region ?? "unknown",
        status: "pending",
        isLocalNode: 0,
      }).onConflictDoNothing();

      newPeers++;
      registered.push(peer.domain);
      webhookNewPeer(peer.domain);
    } catch (err) {
      logger.warn({ domain: peer.domain, err }, "Gossip: failed to register peer");
    }
  }

  if (newPeers > 0) {
    await db.insert(federationEventsTable).values({
      eventType: "handshake",
      fromNodeDomain: fromDomain,
      toNodeDomain: localNode?.domain ?? "local",
      payload: JSON.stringify({ gossipNewPeers: registered }),
      verified: 0,
    });
    logger.info({ fromDomain, newPeers, registered }, "Gossip: registered new peers");
  }

  res.json({ accepted: peers.length, newPeers, registered });
}));

/**
 * POST /api/federation/gossip/discover
 * Manually trigger a gossip cycle: fetch peer lists from all active peers
 * and register any new nodes they know about.
 */
router.post("/federation/gossip/discover", writeLimiter, asyncHandler(async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();

  const [localNode] = await db.select().from(nodesTable).where(eq(nodesTable.isLocalNode, 1));
  const activePeers = await db
    .select({ domain: nodesTable.domain })
    .from(nodesTable)
    .where(and(eq(nodesTable.status, "active"), ne(nodesTable.isLocalNode, 1)));

  // Skip blocked nodes — don't query or register peers from them
  const allowedPeers = activePeers.filter((p) => !isBlocked(p.domain));

  const results: Array<{ peer: string; newNodes: number; error?: string }> = [];

  await Promise.allSettled(
    allowedPeers.map(async ({ domain }) => {
      const peerUrl = domain.startsWith("http") ? domain : `https://${domain}`;
      try {
        const res2 = await fetch(`${peerUrl}/api/federation/gossip`, {
          signal: AbortSignal.timeout(5000),
        });

        if (!res2.ok) {
          results.push({ peer: domain, newNodes: 0, error: `HTTP ${res2.status}` });
          return;
        }

        const data = await res2.json() as { peers?: Array<{ domain: string; name?: string; publicKey?: string; region?: string }> };
        const existingDomains = new Set(
          (await db.select({ domain: nodesTable.domain }).from(nodesTable)).map((n) => n.domain),
        );

        let newNodes = 0;
        for (const peer of data.peers ?? []) {
          if (peer.domain === localNode?.domain) continue;
          if (existingDomains.has(peer.domain)) continue;

          await db.insert(nodesTable).values({
            name: peer.name ?? peer.domain,
            domain: peer.domain,
            publicKey: peer.publicKey ?? "",
            privateKey: "",
            region: peer.region ?? "unknown",
            status: "pending",
            isLocalNode: 0,
          }).onConflictDoNothing();

          newNodes++;
          existingDomains.add(peer.domain);
        }

        results.push({ peer: domain, newNodes });
      } catch (err: any) {
        results.push({ peer: domain, newNodes: 0, error: err.message });
      }
    }),
  );

  const totalNew = results.reduce((s, r) => s + r.newNodes, 0);
  logger.info({ results, totalNew }, "Gossip discover cycle complete");

  res.json({ peersQueried: allowedPeers.length, blocked: activePeers.length - allowedPeers.length, totalNewNodes: totalNew, results });
}));

// ── Background gossip pusher ──────────────────────────────────────────────────

let gossipTimer: NodeJS.Timeout | null = null;

export function startGossipPusher(intervalMs = 5 * 60 * 1000): void {
  if (gossipTimer) return;

  const push = async () => {
    try {
      const [localNode] = await db.select().from(nodesTable).where(eq(nodesTable.isLocalNode, 1));
      if (!localNode?.privateKey) return;

      const activePeers = await db
        .select({ domain: nodesTable.domain, publicKey: nodesTable.publicKey })
        .from(nodesTable)
        .where(and(eq(nodesTable.status, "active"), ne(nodesTable.isLocalNode, 1)));

      if (activePeers.length === 0) return;

      // Exclude blocked nodes — don't broadcast to them or share them with others
      const allowedPeers = activePeers.filter((p) => !isBlocked(p.domain));
      if (allowedPeers.length === 0) return;

      // Build the peer list to share — also exclude blocked nodes so we don't spread them
      const peersToShare = allowedPeers.map((p) => ({ domain: p.domain, publicKey: p.publicKey ?? "" }));

      const timestamp = Date.now();
      const payload = JSON.stringify({ fromDomain: localNode.domain, peers: peersToShare, timestamp });
      const signature = signMessage(localNode.privateKey, payload);

      await Promise.allSettled(
        allowedPeers.map(({ domain }) => {
          const url = domain.startsWith("http") ? domain : `https://${domain}`;
          return fetch(`${url}/api/federation/gossip/push`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Federation-Signature": signature },
            body: payload,
            signal: AbortSignal.timeout(4000),
          }).catch(() => {});
        }),
      );

      logger.debug({ peers: allowedPeers.length, blocked: activePeers.length - allowedPeers.length }, "Gossip push cycle complete");
    } catch (err) {
      logger.warn({ err }, "Gossip pusher error");
    }
  };

  gossipTimer = setInterval(push, intervalMs);
  logger.info({ intervalMs }, "Gossip pusher started");
}

/**
 * GET /api/federation/bootstrap
 *
 * Public bootstrap registry — returns a curated list of healthy, verified
 * nodes that new nodes can use to seed their peer list. Designed to be
 * referenced in documentation and consumed by fh CLI / node startup.
 */
router.get("/federation/bootstrap", asyncHandler(async (_req: Request, res: Response) => {
  const [localNode] = await db.select().from(nodesTable).where(eq(nodesTable.isLocalNode, 1));

  const verifiedPeers = await db
    .select({
      domain: nodesTable.domain,
      name: nodesTable.name,
      region: nodesTable.region,
      publicKey: nodesTable.publicKey,
      status: nodesTable.status,
      lastSeenAt: nodesTable.lastSeenAt,
      verifiedAt: nodesTable.verifiedAt,
      joinedAt: nodesTable.joinedAt,
    })
    .from(nodesTable)
    .where(and(eq(nodesTable.status, "active"), ne(nodesTable.isLocalNode, 1)))
    .orderBy(desc(nodesTable.verifiedAt))
    .limit(50);

  // Only include nodes verified within the last 24 hours for bootstrap reliability
  // Also exclude any nodes on the blocklist
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const healthy = verifiedPeers.filter(
    (p) => p.verifiedAt && new Date(p.verifiedAt) > since && !isBlocked(p.domain),
  );

  res.json({
    protocol: "fedhost/1.0",
    description: "FedHost bootstrap node registry — seed your peer list from here",
    servedBy: localNode?.domain ?? "unknown",
    generatedAt: new Date().toISOString(),
    nodeCount: healthy.length,
    nodes: healthy.map((n) => ({
      domain: n.domain,
      name: n.name,
      region: n.region,
      publicKey: n.publicKey,
      verifiedAt: n.verifiedAt,
    })),
    docs: "https://github.com/The-No-Hands-company/Federated-Hosting/blob/main/FEDERATION.md",
  });
}));

export { startGossipPusher, stopGossipPusher };
export default router;
