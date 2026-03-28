import { test as base, expect, type Page, type APIRequestContext } from "@playwright/test";

export { expect };

// ── API helpers ───────────────────────────────────────────────────────────────

export async function apiGet<T>(request: APIRequestContext, path: string): Promise<T> {
  const res = await request.get(`/api${path}`);
  expect(res.ok(), `GET /api${path} returned ${res.status()}`).toBeTruthy();
  return res.json();
}

export async function apiPost<T>(
  request: APIRequestContext,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<T> {
  const res = await request.post(`/api${path}`, {
    data: body,
    headers: { "Content-Type": "application/json", ...headers },
  });
  expect(res.ok(), `POST /api${path} returned ${res.status()}: ${await res.text()}`).toBeTruthy();
  return res.json();
}

// ── Custom fixtures ───────────────────────────────────────────────────────────

interface FhFixtures {
  /** Authenticated API token for the test user — created once per test */
  apiToken: string;
  /** Convenience: make authed API calls without browser session */
  authedRequest: APIRequestContext;
}

export const test = base.extend<FhFixtures>({
  apiToken: async ({ request }, use) => {
    // Create a short-lived test token via the API
    // In a real test environment this would use a pre-seeded test user session.
    // For now we expose the fixture for future auth integration.
    const token = process.env.NH_TEST_TOKEN ?? "";
    await use(token);
  },

  authedRequest: async ({ playwright, apiToken }, use) => {
    const ctx = await playwright.request.newContext({
      baseURL: process.env.NH_BASE_URL ?? "http://localhost:8080",
      extraHTTPHeaders: apiToken
        ? { Authorization: `Bearer ${apiToken}` }
        : {},
    });
    await use(ctx);
    await ctx.dispose();
  },
});
