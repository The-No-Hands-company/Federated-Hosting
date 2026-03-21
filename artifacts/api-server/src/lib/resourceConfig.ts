/**
 * Low-resource mode configuration.
 *
 * Set LOW_RESOURCE=true to run FedHost on constrained hardware:
 * Raspberry Pi, old laptops, small VMs (1 vCPU / 512 MB RAM).
 *
 * This is the Indonesian volunteer-node profile. A node running in
 * low-resource mode still federates correctly — it just serves fewer
 * concurrent requests and uses less memory.
 *
 * What changes:
 *   DB pool:          max 5 connections  (default: 20)
 *   DB pool min:      1                  (default: 2)
 *   Log level:        warn               (default: info — cuts ~30% log I/O)
 *   Domain cache:     500 entries        (default: 10 000)
 *   File cache:       2 000 entries      (default: 50 000)
 *   Analytics flush:  5 minutes          (default: 1 minute)
 *   Health check:     10 minutes         (default: 2 minutes)
 *   Site health:      30 minutes         (default: 10 minutes)
 *   Global rate limit: 60/min            (default: 300/min)
 *   Concurrent uploads: 2               (default: 60/min)
 *   Compression level: 1 (fastest)       (default: zlib default ~6)
 *   Pino pretty-print: disabled          (always disabled in prod anyway)
 *
 * What does NOT change:
 *   Federation protocol — identical wire format, signatures, gossip
 *   ACME / TLS — still works
 *   Redis integration — still works if REDIS_URL is set
 *   All API routes — fully available
 *   Auth — unchanged
 */

export const LOW_RESOURCE = process.env.LOW_RESOURCE === "true";

/** Database connection pool limits */
export const DB_POOL = LOW_RESOURCE
  ? { max: 5, min: 1, idleTimeoutMillis: 60_000, connectionTimeoutMillis: 8_000 }
  : {
      max:  parseInt(process.env.DB_POOL_MAX  ?? "20"),
      min:  parseInt(process.env.DB_POOL_MIN  ?? "2"),
      idleTimeoutMillis:       parseInt(process.env.DB_IDLE_TIMEOUT_MS    ?? "30000"),
      connectionTimeoutMillis: parseInt(process.env.DB_CONNECT_TIMEOUT_MS ?? "5000"),
    };

/** Pino log level */
export const LOG_LEVEL: string = LOW_RESOURCE
  ? (process.env.LOG_LEVEL ?? "warn")           // quieter on low-RAM nodes
  : (process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "development" ? "debug" : "info"));

/** LRU domain → site cache max entries */
export const DOMAIN_CACHE_MAX = LOW_RESOURCE
  ? parseInt(process.env.DOMAIN_CACHE_MAX ?? "500")
  : parseInt(process.env.DOMAIN_CACHE_MAX ?? "10000");

/** LRU file path → objectPath cache max entries */
export const FILE_CACHE_MAX = LOW_RESOURCE
  ? parseInt(process.env.FILE_CACHE_MAX ?? "2000")
  : parseInt(process.env.FILE_CACHE_MAX ?? "50000");

/** Analytics buffer flush interval (ms) */
export const ANALYTICS_FLUSH_INTERVAL_MS = LOW_RESOURCE
  ? parseInt(process.env.ANALYTICS_FLUSH_INTERVAL_MS ?? "300000")   // 5 minutes
  : parseInt(process.env.ANALYTICS_FLUSH_INTERVAL_MS ?? "60000");   // 1 minute

/** Federation node health check interval (ms) */
export const HEALTH_CHECK_INTERVAL_MS = LOW_RESOURCE
  ? parseInt(process.env.HEALTH_CHECK_INTERVAL_MS ?? "600000")      // 10 minutes
  : parseInt(process.env.HEALTH_CHECK_INTERVAL_MS ?? "120000");     // 2 minutes

/** Site health monitor interval (ms) */
export const SITE_HEALTH_INTERVAL_MS = LOW_RESOURCE
  ? parseInt(process.env.SITE_HEALTH_CHECK_INTERVAL_MS ?? "1800000") // 30 minutes
  : parseInt(process.env.SITE_HEALTH_CHECK_INTERVAL_MS ?? "600000");  // 10 minutes

/** Global rate limit max requests per minute per IP */
export const GLOBAL_RATE_LIMIT = LOW_RESOURCE ? 60 : 300;

/** Upload rate limit max per minute per IP */
export const UPLOAD_RATE_LIMIT = LOW_RESOURCE ? 10 : 60;

/** zlib compression level (1 = fastest/least CPU, 9 = best/most CPU) */
export const COMPRESSION_LEVEL = LOW_RESOURCE ? 1 : 6;

/** Gossip push interval (ms) */
export const GOSSIP_INTERVAL_MS = LOW_RESOURCE
  ? parseInt(process.env.GOSSIP_INTERVAL_MS ?? "600000")  // 10 minutes
  : parseInt(process.env.GOSSIP_INTERVAL_MS ?? "300000"); // 5 minutes

if (LOW_RESOURCE) {
  // Log once at startup so operators know the mode is active
  // Using console directly since the logger may not be initialised yet
  console.warn(
    "[config] LOW_RESOURCE=true — running in low-resource mode. " +
    "DB pool: 5, caches: 500/2K, flush: 5min, health: 10min. " +
    "All API routes and federation remain fully functional."
  );
}
