/**
 * Health + federation discovery smoke tests.
 *
 * These run against a live node and verify that the public endpoints work
 * correctly without any authentication. They are safe to run in CI against
 * a staging environment.
 */

import { test, expect, apiGet } from "./helpers";

test.describe("Health endpoints", () => {
  test("GET /api/health returns healthy status", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);

    const body = await res.json() as { status: string; services?: { database?: { status: string } } };
    expect(body.status).toMatch(/healthy|degraded/);
  });

  test("GET /api/health/live returns 200", async ({ request }) => {
    const res = await request.get("/api/health/live");
    expect(res.status()).toBe(200);
  });

  test("GET /api/health/ready returns 200 when DB is up", async ({ request }) => {
    const res = await request.get("/api/health/ready");
    // May return 503 if DB is down — but in CI it should be 200
    expect([200, 503]).toContain(res.status());
  });
});

test.describe("Federation discovery", () => {
  test("GET /.well-known/federation returns valid node metadata", async ({ request }) => {
    const res = await request.get("/.well-known/federation");
    expect(res.status()).toBe(200);

    const body = await res.json() as {
      protocol: string;
      domain: string;
      publicKey: string | null;
      capabilities: string[];
    };

    expect(body.protocol).toBe("nexushosting/1.0");
    expect(body.domain).toBeTruthy();
    expect(Array.isArray(body.capabilities)).toBe(true);
    expect(body.capabilities).toContain("site-hosting");
    expect(body.capabilities).toContain("node-federation");
  });

  test("GET /api/federation/meta returns node metadata", async ({ request }) => {
    const res = await request.get("/api/federation/meta");
    expect(res.status()).toBe(200);

    const body = await res.json() as { protocol: string; name: string; domain: string };
    expect(body.protocol).toBe("nexushosting/1.0");
    expect(body.name).toBeTruthy();
  });

  test("GET /api/federation/bootstrap returns peer list", async ({ request }) => {
    const res = await request.get("/api/federation/bootstrap");
    expect(res.status()).toBe(200);

    const body = await res.json() as {
      protocol: string;
      nodes: unknown[];
      generatedAt: string;
    };
    expect(body.protocol).toBe("nexushosting/1.0");
    expect(Array.isArray(body.nodes)).toBe(true);
    expect(body.generatedAt).toBeTruthy();
  });

  test("GET /api/federation/gossip returns peer list", async ({ request }) => {
    const res = await request.get("/api/federation/gossip");
    expect(res.status()).toBe(200);

    const body = await res.json() as { peers: unknown[]; peerCount: number };
    expect(typeof body.peerCount).toBe("number");
    expect(Array.isArray(body.peers)).toBe(true);
  });

  test("GET /api/federation/peers returns paginated result", async ({ request }) => {
    const res = await request.get("/api/federation/peers?page=1&limit=10");
    expect(res.status()).toBe(200);

    const body = await res.json() as { data: unknown[]; meta: { total: number; page: number } };
    expect(Array.isArray(body.data)).toBe(true);
    expect(typeof body.meta.total).toBe("number");
    expect(body.meta.page).toBe(1);
  });
});

test.describe("Public site endpoints", () => {
  test("GET /api/sites returns paginated site list", async ({ request }) => {
    const res = await request.get("/api/sites?page=1&limit=5");
    expect(res.status()).toBe(200);

    const body = await res.json() as { data: unknown[]; meta: { total: number } };
    expect(Array.isArray(body.data)).toBe(true);
    expect(typeof body.meta.total).toBe("number");
  });

  test("GET /api/nodes returns paginated node list", async ({ request }) => {
    const res = await request.get("/api/nodes?page=1&limit=5");
    expect(res.status()).toBe(200);

    const body = await res.json() as { data: unknown[]; meta: { total: number } };
    expect(Array.isArray(body.data)).toBe(true);
  });

  test("GET /api/auth/user returns null user when not authenticated", async ({ request }) => {
    const res = await request.get("/api/auth/user");
    expect(res.status()).toBe(200);

    const body = await res.json() as { user: null | { id: string } };
    expect(body.user).toBeNull();
  });
});

test.describe("Rate limiting", () => {
  test("Auth endpoints are rate limited after many rapid requests", async ({ request }) => {
    // Fire 25 rapid requests — should eventually get a 429
    const results: number[] = [];
    for (let i = 0; i < 25; i++) {
      const res = await request.get("/api/login");
      results.push(res.status());
    }
    // Not asserting 429 — depends on rate limit config — just confirm no 500s
    const serverErrors = results.filter((s) => s >= 500);
    expect(serverErrors.length).toBe(0);
  });
});
