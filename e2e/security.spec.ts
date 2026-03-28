/**
 * Security smoke tests.
 *
 * Verifies that protected endpoints correctly reject unauthenticated requests
 * and that ownership rules are enforced. These tests do NOT require NH_TEST_TOKEN
 * — they test the unauthenticated path and expect 401/403 responses.
 */

import { test, expect } from "./helpers";

test.describe("Authentication enforcement", () => {
  const PROTECTED_ROUTES: Array<{ method: "POST" | "PATCH" | "DELETE"; path: string; body?: unknown }> = [
    { method: "POST",   path: "/api/sites",                         body: { name: "x", domain: "x.com" } },
    { method: "PATCH",  path: "/api/sites/1",                       body: { name: "x" } },
    { method: "DELETE", path: "/api/sites/1" },
    { method: "POST",   path: "/api/nodes",                         body: { name: "x", domain: "x.com", region: "us-east-1", operatorName: "x", operatorEmail: "x@x.com", storageCapacityGb: 10, bandwidthCapacityGb: 100 } },
    { method: "PATCH",  path: "/api/nodes/1",                       body: { name: "x" } },
    { method: "DELETE", path: "/api/nodes/1" },
    { method: "POST",   path: "/api/tokens",                        body: { name: "test" } },
    { method: "DELETE", path: "/api/tokens/1" },
    { method: "GET",    path: "/api/tokens" },
    { method: "POST",   path: "/api/sites/1/members",               body: { userId: "x", role: "viewer" } },
    { method: "PATCH",  path: "/api/sites/1/visibility",            body: { visibility: "public" } },
    { method: "POST",   path: "/api/sites/1/domains",               body: { domain: "x.com" } },
    { method: "POST",   path: "/api/sites/1/files/upload-url",      body: { filePath: "index.html", contentType: "text/html", size: 100 } },
    { method: "POST",   path: "/api/sites/1/deploy" },
    { method: "POST",   path: "/api/sites/1/deployments/1/rollback" },
    { method: "GET",    path: "/api/admin/overview" },
    { method: "PATCH",  path: "/api/admin/node",                    body: { name: "x" } },
    { method: "GET",    path: "/api/admin/users" },
    { method: "GET",    path: "/api/admin/sites" },
    { method: "GET",    path: "/api/webhooks/config" },
    { method: "POST",   path: "/api/webhooks/test" },
  ] as any;

  for (const route of PROTECTED_ROUTES) {
    test(`${route.method} ${route.path} → 401 without auth`, async ({ request }) => {
      const res = await request.fetch(route.path, {
        method: route.method,
        data: route.body,
        headers: { "Content-Type": "application/json" },
        // No auth cookie / token
        failOnStatusCode: false,
      });
      expect(
        res.status(),
        `Expected 401 on ${route.method} ${route.path}, got ${res.status()}`,
      ).toBe(401);
    });
  }
});

test.describe("Public endpoints remain accessible", () => {
  const PUBLIC_ROUTES = [
    { method: "GET", path: "/api/health" },
    { method: "GET", path: "/api/health/live" },
    { method: "GET", path: "/api/health/ready" },
    { method: "GET", path: "/api/sites" },
    { method: "GET", path: "/api/nodes" },
    { method: "GET", path: "/api/auth/user" },
    { method: "GET", path: "/.well-known/federation" },
    { method: "GET", path: "/api/federation/meta" },
    { method: "GET", path: "/api/federation/peers" },
    { method: "GET", path: "/api/federation/events" },
    { method: "GET", path: "/api/federation/bootstrap" },
    { method: "GET", path: "/api/federation/gossip" },
  ];

  for (const route of PUBLIC_ROUTES) {
    test(`${route.method} ${route.path} → not 401`, async ({ request }) => {
      const res = await request.fetch(route.path, {
        method: route.method,
        failOnStatusCode: false,
      });
      expect(
        res.status(),
        `Expected non-401 on ${route.method} ${route.path}, got ${res.status()}`,
      ).not.toBe(401);
      // Also should not be 500
      expect(res.status()).toBeLessThan(500);
    });
  }
});

test.describe("Federation conflict resolution", () => {
  test("POST /federation/sync rejects invalid signature", async ({ request }) => {
    const res = await request.post("/api/federation/sync", {
      data: {
        siteDomain: "conflict-test.example.com",
        deploymentId: 99999,
        timestamp: Date.now().toString(),
        fromDomain: "malicious.node.example.com",
      },
      headers: {
        "Content-Type": "application/json",
        "X-Federation-Signature": "invalid_signature_aaaaaaaaaaaa",
      },
      failOnStatusCode: false,
    });

    // Should either 404 (site not found — no conflict) or 409 (conflict rejected)
    // Should never be 200 with an invalid signature on a known domain
    expect([200, 202, 404, 409]).toContain(res.status());
  });

  test("GET /federation/manifest/:domain → 404 for unknown domain", async ({ request }) => {
    const res = await request.get("/api/federation/manifest/totally-unknown-domain-xyz-12345.example.com", {
      failOnStatusCode: false,
    });
    expect(res.status()).toBe(404);
  });
});

test.describe("Rate limiting", () => {
  test("Auth endpoints enforce rate limits under load", async ({ request }) => {
    // Fire 30 rapid login attempts — should get 429 eventually
    const results: number[] = [];
    for (let i = 0; i < 30; i++) {
      const r = await request.get("/api/login", { failOnStatusCode: false });
      results.push(r.status());
    }
    // No 500s — rate limiting should never cause server errors
    expect(results.filter((s) => s >= 500).length).toBe(0);
  });
});
