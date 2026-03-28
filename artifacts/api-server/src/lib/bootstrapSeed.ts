/**
 * Bootstrap seed node service.
 *
 * When a new node starts up with no known peers, it has nobody to federate with.
 * This service solves that by fetching peer lists from well-known bootstrap URLs
 * and registering any discovered nodes.
 *
 * Configuration:
 *   BOOTSTRAP_URLS — comma-separated list of bootstrap endpoints, e.g.:
 *     https://bootstrap.nexushosting.example/api/federation/bootstrap,https://node2.example/api/federation/bootstrap
 *
 * The bootstrap endpoint returns the same format as GET /api/federation/bootstrap.
 * Any node operator can run a bootstrap node — there is no central authority.
 *
 * This runs once at startup, then never again (nodes learn about each other via gossip).
 */

import { db, nodesTable, nodeTrustTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import logger from "./logger.js";

const USER_AGENT = "NexusHosting-Node/1.0 (bootstrap-seed; +https://github.com/The-No-Hands-company/Nexus-Hosting)";

interface BootstrapNode {
  domain: string;
  name: string;
  region: string;
  publicKey: string;
  verifiedAt?: string;
}

interface BootstrapResponse {
  protocol: string;
  nodes: BootstrapNode[];
}

/** Fetch and register peers from a single bootstrap URL. Returns count added. */
async function seedFromUrl(url: string): Promise<number> {
  let data: BootstrapResponse;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, "Accept": "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      logger.warn({ url, status: res.status }, "[bootstrap] Seed URL returned non-200");
      return 0;
    }
    data = await res.json() as BootstrapResponse;
  } catch (err: any) {
    logger.warn({ url, err: err.message }, "[bootstrap] Failed to fetch seed URL");
    return 0;
  }

  if (!Array.isArray(data.nodes)) {
    logger.warn({ url }, "[bootstrap] Seed response missing nodes array");
    return 0;
  }

  let added = 0;
  for (const node of data.nodes) {
    if (!node.domain || !node.publicKey) continue;
    try {
      // Only insert if we don't already know this node
      const existing = await db
        .select({ id: nodesTable.id })
        .from(nodesTable)
        .where(eq(nodesTable.domain, node.domain))
        .limit(1);

      if (existing.length > 0) continue;

      await db.insert(nodesTable).values({
        name:               node.name || node.domain,
        domain:             node.domain,
        region:             node.region || "unknown",
        publicKey:          node.publicKey,
        operatorName:       "Unknown (seeded)",
        operatorEmail:      "unknown@seeded",
        storageCapacityGb:  0,
        bandwidthCapacityGb: 0,
        status:             "active",
        isLocalNode:        0,
      });

      // Register in trust table as unverified (will promote after first successful ping)
      await db.insert(nodeTrustTable).values({
        nodeDomain:  node.domain,
        trustLevel:  "unverified",
        firstSeenAt: new Date(),
      }).onConflictDoNothing();

      added++;
      logger.info({ domain: node.domain }, "[bootstrap] Seeded peer from bootstrap");
    } catch (err: any) {
      logger.debug({ domain: node.domain, err: err.message }, "[bootstrap] Skipped duplicate node");
    }
  }

  return added;
}

/**
 * Run the bootstrap seed process.
 * Reads BOOTSTRAP_URLS env var, fetches each, registers new peers.
 * Skips gracefully if no URLs configured or if node already has peers.
 */
export async function runBootstrapSeed(): Promise<void> {
  const urlsEnv = process.env.BOOTSTRAP_URLS ?? "";
  const urls = urlsEnv.split(",").map(u => u.trim()).filter(Boolean);

  if (urls.length === 0) {
    logger.info("[bootstrap] No BOOTSTRAP_URLS configured — skipping seed. " +
      "Set BOOTSTRAP_URLS to a comma-separated list of bootstrap endpoints to auto-discover peers.");
    return;
  }

  // Check if we already have peers (don't re-seed unnecessarily)
  const [{ count }] = await db
    .select({ count: db.$count(nodesTable) } as any)
    .from(nodesTable)
    .where(eq(nodesTable.isLocalNode, 0)) as any;

  const peerCount = Number(count ?? 0);
  if (peerCount > 5) {
    logger.info({ peerCount }, "[bootstrap] Already have peers — skipping bootstrap seed");
    return;
  }

  logger.info({ urls, existingPeers: peerCount }, "[bootstrap] Seeding from bootstrap URLs…");

  let totalAdded = 0;
  for (const url of urls) {
    const added = await seedFromUrl(url);
    totalAdded += added;
  }

  logger.info({ totalAdded }, `[bootstrap] Seed complete — added ${totalAdded} new peer(s)`);
}
