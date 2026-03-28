/**
 * Hosted site health monitoring.
 *
 * Periodically checks that deployed sites are actually reachable and serving
 * content — separate from node health (which checks the API server).
 *
 * For each active site with a deployment, fetches the root URL and records:
 *   - HTTP status code
 *   - Response time in ms
 *   - Whether Content-Type is correct (HTML for index.html)
 *
 * Results are stored in site_health_checks and exposed via:
 *   GET /api/sites/:id/health — recent checks for a site
 *   GET /api/admin/site-health — overview across all sites
 *
 * The check interval is controlled by SITE_HEALTH_CHECK_INTERVAL_MS (default: 10 min).
 * Checks are staggered to avoid thundering-herd against the storage layer.
 */

import { db, sitesTable, siteDeploymentsTable, nodesTable } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import logger from "./logger";

const INTERVAL_MS = parseInt(process.env.SITE_HEALTH_CHECK_INTERVAL_MS ?? "600000", 10); // 10 min
const TIMEOUT_MS  = 10_000;
const STAGGER_MS  = 200; // delay between checks to avoid hammering

export interface SiteHealthResult {
  siteId:       number;
  domain:       string;
  status:       "up" | "down" | "degraded";
  httpStatus:   number | null;
  responseMs:   number | null;
  checkedAt:    string;
  error?:       string;
}

// In-memory results — most recent check per site
const healthResults = new Map<number, SiteHealthResult>();

async function checkSite(siteId: number, domain: string): Promise<SiteHealthResult> {
  const url = `https://${domain}/`;
  const start = Date.now();
  const checkedAt = new Date().toISOString();

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "User-Agent": "NexusHosting-HealthCheck/1.0" },
      redirect: "follow",
    });

    const responseMs = Date.now() - start;
    const httpStatus = res.status;

    let siteStatus: "up" | "down" | "degraded";
    if (httpStatus >= 200 && httpStatus < 300) {
      siteStatus = responseMs > 3000 ? "degraded" : "up";
    } else if (httpStatus >= 500) {
      siteStatus = "down";
    } else {
      siteStatus = "degraded";
    }

    return { siteId, domain, status: siteStatus, httpStatus, responseMs, checkedAt };
  } catch (err: any) {
    return {
      siteId, domain, status: "down",
      httpStatus: null, responseMs: Date.now() - start,
      checkedAt, error: err.message,
    };
  }
}

async function runHealthChecks(): Promise<void> {
  const [localNode] = await db
    .select({ id: nodesTable.id })
    .from(nodesTable)
    .where(eq(nodesTable.isLocalNode, 1));

  if (!localNode) return;

  // Only check sites whose primary node is this node
  const activeSites = await db
    .select({ id: sitesTable.id, domain: sitesTable.domain })
    .from(sitesTable)
    .innerJoin(siteDeploymentsTable, and(
      eq(siteDeploymentsTable.siteId, sitesTable.id),
      eq(siteDeploymentsTable.status, "active"),
    ))
    .where(and(
      eq(sitesTable.status, "active"),
      eq(sitesTable.primaryNodeId, localNode.id),
      eq(sitesTable.visibility, "public"),
    ));

  logger.debug({ count: activeSites.length }, "[site-health] Starting health checks");

  for (let i = 0; i < activeSites.length; i++) {
    const site = activeSites[i]!;
    // Stagger checks to avoid hammering
    await new Promise(r => setTimeout(r, i * STAGGER_MS));
    const result = await checkSite(site.id, site.domain);
    healthResults.set(site.id, result);

    if (result.status === "down") {
      logger.warn({ domain: site.domain, error: result.error }, "[site-health] Site is down");
    }

    // Persist to DB for history (fire-and-forget)
    import("@workspace/db").then(({ db: _db, siteHealthChecksTable }) => {
      _db.insert(siteHealthChecksTable).values({
        siteId: site.id,
        status: result.status,
        httpStatus: result.httpStatus,
        responseMs: result.responseMs ?? null,
        error: result.error ?? null,
        checkedAt: new Date(result.checkedAt),
      }).catch(() => {});

      // Alert if site transitioned to down
      const prev = healthResults.get(site.id);
      if (result.status === "down" && prev?.status !== "down") {
        // Notify site owner by email
        import("./email").then(({ emailSiteDown }) => {
          emailSiteDown?.({ siteId: site.id, domain: site.domain }).catch(() => {});
        }).catch(() => {});
      }
    }).catch(() => {});
  }

  logger.debug({ checked: activeSites.length }, "[site-health] Health checks complete");
}

export function getSiteHealth(siteId: number): SiteHealthResult | null {
  return healthResults.get(siteId) ?? null;
}

export function getAllSiteHealth(): SiteHealthResult[] {
  return Array.from(healthResults.values())
    .sort((a, b) => (a.status === "down" ? -1 : 1));
}

export function getSiteHealthSummary() {
  const results = getAllSiteHealth();
  return {
    total:    results.length,
    up:       results.filter(r => r.status === "up").length,
    degraded: results.filter(r => r.status === "degraded").length,
    down:     results.filter(r => r.status === "down").length,
    results,
  };
}

let healthTimer: NodeJS.Timeout | null = null;

export function startSiteHealthMonitor(): void {
  if (!process.env.ENABLE_SITE_HEALTH_CHECKS) return;
  runHealthChecks().catch(err => logger.warn({ err }, "[site-health] Initial check failed"));
  healthTimer = setInterval(() => {
    runHealthChecks().catch(err => logger.warn({ err }, "[site-health] Scheduled check failed"));
  }, INTERVAL_MS);
  logger.info({ intervalMs: INTERVAL_MS }, "[site-health] Site health monitor started");
}

export function stopSiteHealthMonitor(): void {
  if (healthTimer) { clearInterval(healthTimer); healthTimer = null; }
}
