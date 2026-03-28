/**
 * End-to-end deploy flow test — the critical path.
 *
 * Tests the full lifecycle via API (no browser UI):
 *   1. Authenticate with a Bearer token
 *   2. Create a site
 *   3. Request presigned upload URL
 *   4. Upload a file
 *   5. Register the file
 *   6. Deploy the site
 *   7. Verify the site serves correctly
 *   8. Check analytics are recording
 *   9. Rollback the deployment
 *   10. Verify the rollback deployment is active
 *
 * Requires NH_TEST_TOKEN env var pointing at a valid API token for the test node.
 * Skip gracefully if no token is available (safe for open PRs from forks).
 */

import { test, expect } from "./helpers";

const TEST_DOMAIN = `e2e-test-${Date.now()}.nexushosting.test`;

test.describe("End-to-end deploy flow", () => {
  test.skip(
    !process.env.NH_TEST_TOKEN,
    "NH_TEST_TOKEN not set — skipping authenticated E2E tests",
  );

  let siteId: number;
  let deploymentId: number;
  let firstVersion: number;

  test("step 1: auth token is valid", async ({ authedRequest }) => {
    const res = await authedRequest.get("/api/auth/user");
    expect(res.status()).toBe(200);
    const body = await res.json() as { user: { id: string } | null };
    expect(body.user).not.toBeNull();
    expect(body.user?.id).toBeTruthy();
  });

  test("step 2: create a site", async ({ authedRequest }) => {
    const res = await authedRequest.post("/api/sites", {
      data: {
        name: "E2E Test Site",
        domain: TEST_DOMAIN,
        siteType: "static",
        ownerName: "E2E Test",
        ownerEmail: "e2e@test.local",
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json() as { id: number; domain: string };
    expect(body.id).toBeGreaterThan(0);
    expect(body.domain).toBe(TEST_DOMAIN);
    siteId = body.id;
  });

  test("step 3+4+5: upload a file via presigned URL", async ({ authedRequest, request }) => {
    // 3. Request upload URL
    const urlRes = await authedRequest.post(`/api/sites/${siteId}/files/upload-url`, {
      data: {
        filePath: "index.html",
        contentType: "text/html",
        size: 100,
      },
    });
    expect(urlRes.status()).toBe(200);
    const { uploadUrl, objectPath } = await urlRes.json() as { uploadUrl: string; objectPath: string };
    expect(uploadUrl).toBeTruthy();
    expect(objectPath).toBeTruthy();

    // 4. Upload file content to presigned URL
    const html = `<!DOCTYPE html><html><head><title>E2E Test</title></head><body><h1>E2E Deploy Test — ${Date.now()}</h1></body></html>`;
    const putRes = await request.put(uploadUrl, {
      data: html,
      headers: { "Content-Type": "text/html" },
    });
    // Presigned URL upload may return 200 or 204
    expect([200, 204]).toContain(putRes.status());

    // 5. Register file
    const regRes = await authedRequest.post(`/api/sites/${siteId}/files`, {
      data: {
        filePath: "index.html",
        objectPath,
        contentType: "text/html",
        sizeBytes: html.length,
      },
    });
    expect(regRes.status()).toBe(201);
    const file = await regRes.json() as { id: number; filePath: string };
    expect(file.filePath).toBe("index.html");
  });

  test("step 6: deploy the site", async ({ authedRequest }) => {
    const res = await authedRequest.post(`/api/sites/${siteId}/deploy`, {
      data: {},
    });
    expect(res.status()).toBe(200);
    const body = await res.json() as {
      id: number;
      version: number;
      status: string;
      fileCount: number;
      replication: { peers: number; synced: number };
    };
    expect(body.status).toBe("active");
    expect(body.fileCount).toBe(1);
    expect(body.version).toBe(1);
    deploymentId = body.id;
    firstVersion = body.version;
  });

  test("step 7: site serves index.html via serve endpoint", async ({ request }) => {
    const res = await request.get(`/api/sites/serve/${TEST_DOMAIN}/index.html`);
    expect(res.status()).toBe(200);
    const ct = res.headers()["content-type"] ?? "";
    expect(ct).toContain("text/html");
    const body = await res.text();
    expect(body).toContain("E2E Deploy Test");
  });

  test("step 8: analytics endpoint returns data for site", async ({ authedRequest }) => {
    const res = await authedRequest.get(`/api/sites/${siteId}/analytics?period=24h`);
    expect(res.status()).toBe(200);
    const body = await res.json() as {
      period: string;
      totals: { hits: number; bytesServed: number; uniqueIps: number };
    };
    expect(body.period).toBe("24h");
    expect(typeof body.totals.hits).toBe("number");
  });

  test("step 9: deploy a second version (needed for rollback)", async ({ authedRequest, request }) => {
    // Upload v2 file
    const urlRes = await authedRequest.post(`/api/sites/${siteId}/files/upload-url`, {
      data: { filePath: "index.html", contentType: "text/html", size: 50 },
    });
    const { uploadUrl, objectPath } = await urlRes.json() as { uploadUrl: string; objectPath: string };

    await request.put(uploadUrl, {
      data: `<!DOCTYPE html><html><body><h1>V2</h1></body></html>`,
      headers: { "Content-Type": "text/html" },
    });

    await authedRequest.post(`/api/sites/${siteId}/files`, {
      data: { filePath: "index.html", objectPath, contentType: "text/html", sizeBytes: 50 },
    });

    const deployRes = await authedRequest.post(`/api/sites/${siteId}/deploy`, { data: {} });
    expect(deployRes.status()).toBe(200);
    const v2 = await deployRes.json() as { version: number };
    expect(v2.version).toBe(2);
  });

  test("step 10: rollback to v1", async ({ authedRequest }) => {
    const res = await authedRequest.post(
      `/api/sites/${siteId}/deployments/${deploymentId}/rollback`,
      { data: {} },
    );
    expect(res.status()).toBe(200);
    const body = await res.json() as { version: number; status: string; rolledBackFrom: number };
    expect(body.status).toBe("active");
    expect(body.rolledBackFrom).toBe(deploymentId);
    expect(body.version).toBe(3); // rollback creates v3 pointing at v1 files
  });

  test("step 11: cleanup — delete test site", async ({ authedRequest }) => {
    const res = await authedRequest.delete(`/api/sites/${siteId}`);
    expect(res.status()).toBe(204);
  });
});
