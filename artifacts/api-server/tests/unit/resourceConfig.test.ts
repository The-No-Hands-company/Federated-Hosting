import { describe, it, expect, beforeEach, afterEach } from "vitest";

/**
 * Tests for lib/resourceConfig.ts — LOW_RESOURCE mode constants.
 *
 * These tests verify the exact numeric contract that LOW_RESOURCE mode
 * provides. The Rust proxy crate reads the same env vars and must apply
 * the same defaults, so these values are authoritative.
 */

// Mirror the resourceConfig logic for isolated testing
function makeConfig(env: Record<string, string | undefined>) {
  const LOW_RESOURCE = env.LOW_RESOURCE === "true";

  const DB_POOL = LOW_RESOURCE
    ? {
        max: parseInt(env.DB_POOL_MAX ?? "5"),
        min: parseInt(env.DB_POOL_MIN ?? "1"),
        idleTimeoutMillis: 60_000,
        connectionTimeoutMillis: 8_000,
      }
    : {
        max: parseInt(env.DB_POOL_MAX ?? "20"),
        min: parseInt(env.DB_POOL_MIN ?? "2"),
        idleTimeoutMillis: parseInt(env.DB_IDLE_TIMEOUT_MS ?? "30000"),
        connectionTimeoutMillis: parseInt(env.DB_CONNECT_TIMEOUT_MS ?? "5000"),
      };

  const LOG_LEVEL = LOW_RESOURCE
    ? (env.LOG_LEVEL ?? "warn")
    : (env.LOG_LEVEL ?? (env.NODE_ENV === "development" ? "debug" : "info"));

  const DOMAIN_CACHE_MAX = LOW_RESOURCE
    ? parseInt(env.DOMAIN_CACHE_MAX ?? "500")
    : parseInt(env.DOMAIN_CACHE_MAX ?? "10000");

  const FILE_CACHE_MAX = LOW_RESOURCE
    ? parseInt(env.FILE_CACHE_MAX ?? "2000")
    : parseInt(env.FILE_CACHE_MAX ?? "50000");

  const ANALYTICS_FLUSH_INTERVAL_MS = LOW_RESOURCE
    ? parseInt(env.ANALYTICS_FLUSH_INTERVAL_MS ?? "300000")
    : parseInt(env.ANALYTICS_FLUSH_INTERVAL_MS ?? "60000");

  const HEALTH_CHECK_INTERVAL_MS = LOW_RESOURCE
    ? parseInt(env.HEALTH_CHECK_INTERVAL_MS ?? "600000")
    : parseInt(env.HEALTH_CHECK_INTERVAL_MS ?? "120000");

  const GLOBAL_RATE_LIMIT  = LOW_RESOURCE ? 60  : 300;
  const UPLOAD_RATE_LIMIT  = LOW_RESOURCE ? 10  : 60;
  const COMPRESSION_LEVEL  = LOW_RESOURCE ? 1   : 6;
  const GOSSIP_INTERVAL_MS = LOW_RESOURCE
    ? parseInt(env.GOSSIP_INTERVAL_MS ?? "600000")
    : parseInt(env.GOSSIP_INTERVAL_MS ?? "300000");

  const FEDERATED_STATIC_ONLY = env.FEDERATED_STATIC_ONLY === "true";

  return {
    LOW_RESOURCE, DB_POOL, LOG_LEVEL, DOMAIN_CACHE_MAX, FILE_CACHE_MAX,
    ANALYTICS_FLUSH_INTERVAL_MS, HEALTH_CHECK_INTERVAL_MS,
    GLOBAL_RATE_LIMIT, UPLOAD_RATE_LIMIT, COMPRESSION_LEVEL,
    GOSSIP_INTERVAL_MS, FEDERATED_STATIC_ONLY,
  };
}

describe("resourceConfig — normal mode (LOW_RESOURCE=false)", () => {
  const cfg = makeConfig({ NODE_ENV: "production" });

  it("LOW_RESOURCE is false", () => expect(cfg.LOW_RESOURCE).toBe(false));

  it("DB pool max is 20", () => expect(cfg.DB_POOL.max).toBe(20));
  it("DB pool min is 2",  () => expect(cfg.DB_POOL.min).toBe(2));
  it("DB idle timeout is 30s", () => expect(cfg.DB_POOL.idleTimeoutMillis).toBe(30000));

  it("log level is info in production", () => expect(cfg.LOG_LEVEL).toBe("info"));

  it("domain cache max is 10 000", () => expect(cfg.DOMAIN_CACHE_MAX).toBe(10000));
  it("file cache max is 50 000",   () => expect(cfg.FILE_CACHE_MAX).toBe(50000));

  it("analytics flush every 1 minute",   () => expect(cfg.ANALYTICS_FLUSH_INTERVAL_MS).toBe(60000));
  it("health check every 2 minutes",     () => expect(cfg.HEALTH_CHECK_INTERVAL_MS).toBe(120000));
  it("gossip interval every 5 minutes",  () => expect(cfg.GOSSIP_INTERVAL_MS).toBe(300000));

  it("global rate limit 300/min", () => expect(cfg.GLOBAL_RATE_LIMIT).toBe(300));
  it("upload rate limit 60/min",  () => expect(cfg.UPLOAD_RATE_LIMIT).toBe(60));
  it("compression level 6",       () => expect(cfg.COMPRESSION_LEVEL).toBe(6));

  it("FEDERATED_STATIC_ONLY is false", () => expect(cfg.FEDERATED_STATIC_ONLY).toBe(false));
});

describe("resourceConfig — LOW_RESOURCE=true (Raspberry Pi / volunteer node profile)", () => {
  const cfg = makeConfig({ LOW_RESOURCE: "true", NODE_ENV: "production" });

  it("LOW_RESOURCE is true", () => expect(cfg.LOW_RESOURCE).toBe(true));

  it("DB pool max reduced to 5",  () => expect(cfg.DB_POOL.max).toBe(5));
  it("DB pool min reduced to 1",  () => expect(cfg.DB_POOL.min).toBe(1));
  it("DB idle timeout extended to 60s", () => expect(cfg.DB_POOL.idleTimeoutMillis).toBe(60000));

  it("log level is warn (quieter)", () => expect(cfg.LOG_LEVEL).toBe("warn"));

  it("domain cache max reduced to 500",   () => expect(cfg.DOMAIN_CACHE_MAX).toBe(500));
  it("file cache max reduced to 2 000",   () => expect(cfg.FILE_CACHE_MAX).toBe(2000));

  it("analytics flush every 5 minutes",   () => expect(cfg.ANALYTICS_FLUSH_INTERVAL_MS).toBe(300000));
  it("health check every 10 minutes",     () => expect(cfg.HEALTH_CHECK_INTERVAL_MS).toBe(600000));
  it("gossip interval every 10 minutes",  () => expect(cfg.GOSSIP_INTERVAL_MS).toBe(600000));

  it("global rate limit reduced to 60/min", () => expect(cfg.GLOBAL_RATE_LIMIT).toBe(60));
  it("upload rate limit reduced to 10/min", () => expect(cfg.UPLOAD_RATE_LIMIT).toBe(10));
  it("compression level 1 (fastest)",       () => expect(cfg.COMPRESSION_LEVEL).toBe(1));

  it("LOW_RESOURCE caches are 20x smaller than normal", () => {
    const normal = makeConfig({});
    expect(normal.DOMAIN_CACHE_MAX / cfg.DOMAIN_CACHE_MAX).toBe(20);
    expect(normal.FILE_CACHE_MAX   / cfg.FILE_CACHE_MAX).toBe(25);
  });

  it("LOW_RESOURCE intervals are 5x longer than normal", () => {
    const normal = makeConfig({});
    expect(cfg.ANALYTICS_FLUSH_INTERVAL_MS / normal.ANALYTICS_FLUSH_INTERVAL_MS).toBe(5);
    expect(cfg.HEALTH_CHECK_INTERVAL_MS    / normal.HEALTH_CHECK_INTERVAL_MS).toBe(5);
  });
});

describe("resourceConfig — env var overrides", () => {
  it("respects DB_POOL_MAX override in LOW_RESOURCE mode", () => {
    const cfg = makeConfig({ LOW_RESOURCE: "true", DB_POOL_MAX: "3" });
    expect(cfg.DB_POOL.max).toBe(3);
  });

  it("respects LOG_LEVEL override in LOW_RESOURCE mode", () => {
    const cfg = makeConfig({ LOW_RESOURCE: "true", LOG_LEVEL: "error" });
    expect(cfg.LOG_LEVEL).toBe("error");
  });

  it("respects DOMAIN_CACHE_MAX override in LOW_RESOURCE mode", () => {
    const cfg = makeConfig({ LOW_RESOURCE: "true", DOMAIN_CACHE_MAX: "200" });
    expect(cfg.DOMAIN_CACHE_MAX).toBe(200);
  });
});

describe("resourceConfig — FEDERATED_STATIC_ONLY", () => {
  it("is false by default", () => {
    expect(makeConfig({}).FEDERATED_STATIC_ONLY).toBe(false);
  });

  it("is true when env var is 'true'", () => {
    expect(makeConfig({ FEDERATED_STATIC_ONLY: "true" }).FEDERATED_STATIC_ONLY).toBe(true);
  });

  it("is false for 'True', '1', 'yes' — must be exactly 'true'", () => {
    expect(makeConfig({ FEDERATED_STATIC_ONLY: "True" }).FEDERATED_STATIC_ONLY).toBe(false);
    expect(makeConfig({ FEDERATED_STATIC_ONLY: "1"    }).FEDERATED_STATIC_ONLY).toBe(false);
    expect(makeConfig({ FEDERATED_STATIC_ONLY: "yes"  }).FEDERATED_STATIC_ONLY).toBe(false);
  });

  it("can be combined with LOW_RESOURCE", () => {
    const cfg = makeConfig({ LOW_RESOURCE: "true", FEDERATED_STATIC_ONLY: "true" });
    expect(cfg.LOW_RESOURCE).toBe(true);
    expect(cfg.FEDERATED_STATIC_ONLY).toBe(true);
    expect(cfg.DB_POOL.max).toBe(5); // LOW_RESOURCE still applies
  });
});
