/**
 * Prometheus metrics.
 *
 * Exposes GET /metrics in Prometheus text format.
 * Scraped by Prometheus / Grafana Agent / VictoriaMetrics.
 *
 * Metrics exposed:
 *   nexus_http_requests_total          - HTTP request count by method/route/status
 *   nexus_http_request_duration_seconds - HTTP request latency histogram
 *   nexus_http_active_requests         - Currently in-flight requests
 *   nexus_db_query_duration_seconds    - Database query latency (manual)
 *   nexus_sites_total                  - Total sites hosted
 *   nexus_deployments_total            - Deployments by status
 *   nexus_federation_peers_total       - Active federation peers
 *   nexus_federation_syncs_total       - Federation sync attempts by result
 *   nexus_analytics_hits_total         - Buffered analytics hits
 *   nexus_cache_entries                - LRU cache size by type
 *   nexus_sync_queue_depth             - Pending federation retry queue depth
 *   + all default Node.js metrics (CPU, memory, GC, event loop lag)
 */

import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from "prom-client";
import type { Request, Response, NextFunction } from "express";

export const registry = new Registry();

// Default Node.js metrics (CPU, memory, GC, event loop lag, active handles)
collectDefaultMetrics({ register: registry, prefix: "nexus_nodejs_" });

// ── HTTP metrics ──────────────────────────────────────────────────────────────

export const httpRequestsTotal = new Counter({
  name: "nexus_http_requests_total",
  help: "Total HTTP requests",
  labelNames: ["method", "route", "status_code"],
  registers: [registry],
});

export const httpRequestDuration = new Histogram({
  name: "nexus_http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

export const httpActiveRequests = new Gauge({
  name: "nexus_http_active_requests",
  help: "Number of HTTP requests currently being processed",
  registers: [registry],
});

// ── Business metrics ──────────────────────────────────────────────────────────

export const sitesTotal = new Gauge({
  name: "nexus_sites_total",
  help: "Total number of sites hosted on this node",
  labelNames: ["status"],
  registers: [registry],
});

export const deploymentsTotal = new Counter({
  name: "nexus_deployments_total",
  help: "Total deployment attempts",
  labelNames: ["status"],
  registers: [registry],
});

export const federationPeersTotal = new Gauge({
  name: "nexus_federation_peers_total",
  help: "Number of federation peers by status",
  labelNames: ["status"],
  registers: [registry],
});

export const federationSyncsTotal = new Counter({
  name: "nexus_federation_syncs_total",
  help: "Federation sync attempts",
  labelNames: ["result"],
  registers: [registry],
});

export const analyticsHitsTotal = new Counter({
  name: "nexus_analytics_hits_total",
  help: "Total analytics hits recorded",
  registers: [registry],
});

export const cacheEntries = new Gauge({
  name: "nexus_cache_entries",
  help: "Number of entries in the in-memory LRU caches",
  labelNames: ["cache_type"],
  registers: [registry],
});

export const syncQueueDepth = new Gauge({
  name: "nexus_sync_queue_depth",
  help: "Number of pending federation sync retries",
  registers: [registry],
});

export const storageOperationsTotal = new Counter({
  name: "nexus_storage_operations_total",
  help: "Object storage operations",
  labelNames: ["operation", "result"],
  registers: [registry],
});

// ── Express middleware ────────────────────────────────────────────────────────

/**
 * HTTP instrumentation middleware.
 * Attach to app before all routes.
 */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Skip the metrics endpoint itself and health probes to avoid noise
  if (req.path === "/metrics" || req.path === "/api/health/live") {
    next();
    return;
  }

  httpActiveRequests.inc();
  const end = httpRequestDuration.startTimer();
  const startTime = Date.now();

  res.on("finish", () => {
    httpActiveRequests.dec();
    const route = normaliseRoute(req.path);
    const labels = { method: req.method, route, status_code: String(res.statusCode) };
    end(labels);
    httpRequestsTotal.inc(labels);
  });

  next();
}

/**
 * Collapse high-cardinality path segments to keep metric label count bounded.
 * e.g. /api/sites/42/deploy → /api/sites/:id/deploy
 */
function normaliseRoute(path: string): string {
  return path
    .replace(/\/\d+/g, "/:id")
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "/:uuid")
    .replace(/\/[a-z0-9]{20,}/g, "/:token")
    .slice(0, 100); // cap length
}
