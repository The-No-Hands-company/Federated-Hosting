import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startCloudRouteSync } from "../../src/lib/cloudRouteSync";

type MutableTrustSummary = {
  nodes: {
    total: number;
    pending: number;
    verified: number;
    trusted: number;
    quarantined: number;
    revoked: number;
    expired: number;
  };
  peers: {
    total: number;
    pending: number;
    verified: number;
    trusted: number;
    quarantined: number;
    revoked: number;
    expired: number;
  };
  updatedAt: string;
};

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function waitForJsonFile<T>(path: string, attempts = 20): Promise<T> {
  let lastError: unknown;
  for (let index = 0; index < attempts; index += 1) {
    try {
      return JSON.parse(await readFile(path, "utf8")) as T;
    } catch (error) {
      lastError = error;
      await flushAsyncWork();
    }
  }
  throw lastError;
}

describe("Cloud trust transition sync", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("updates the synced Hosting snapshot when Cloud peer trust transitions", async () => {
    vi.useFakeTimers();

    const tempDir = await mkdtemp(join(tmpdir(), "nexus-hosting-cloud-trust-"));
    const outputPath = join(tempDir, "cloud-route-table.json");

    const trustSummary: MutableTrustSummary = {
      nodes: {
        total: 2,
        pending: 0,
        verified: 1,
        trusted: 1,
        quarantined: 0,
        revoked: 0,
        expired: 0,
      },
      peers: {
        total: 3,
        pending: 0,
        verified: 1,
        trusted: 2,
        quarantined: 0,
        revoked: 0,
        expired: 0,
      },
      updatedAt: new Date("2026-04-27T00:00:00.000Z").toISOString(),
    };

    const fetchMock = vi.spyOn(globalThis, "fetch" as any).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/v1/routes")) {
        return new Response(JSON.stringify({ routes: [{ domain: "app.example.com", upstream: "http://127.0.0.1:3000", toolId: "tool-a", kind: "website", status: "active" }] }), { status: 200 });
      }
      if (url.endsWith("/api/v1/exposures")) {
        return new Response(JSON.stringify({ exposures: [] }), { status: 200 });
      }
      if (url.endsWith("/api/v1/domains")) {
        return new Response(JSON.stringify({ domains: [] }), { status: 200 });
      }
      if (url.includes("/api/v1/status?compact=trust")) {
        return new Response(JSON.stringify({ scope: "trust-lifecycle", trust: trustSummary }), { status: 200 });
      }
      throw new Error(`Unhandled fetch URL in test: ${url}`);
    });

    const stop = startCloudRouteSync({
      cloudBaseUrl: "https://cloud.example.com",
      apiKey: "api-key",
      outputPath,
      intervalMs: 10_000,
    });

    try {
      await flushAsyncWork();
      const initial = await waitForJsonFile<{
        trust: MutableTrustSummary;
        summary: { trustedPeerCount: number; peerCount: number };
      }>(outputPath);

      expect(initial.trust.peers.trusted).toBe(2);
      expect(initial.summary.trustedPeerCount).toBe(2);
      expect(initial.summary.peerCount).toBe(3);

      trustSummary.peers.trusted = 1;
      trustSummary.peers.quarantined = 1;
      trustSummary.updatedAt = new Date("2026-04-27T00:05:00.000Z").toISOString();

      await vi.advanceTimersByTimeAsync(10_000);
      await flushAsyncWork();

      const updated = await waitForJsonFile<{
        trust: MutableTrustSummary;
        summary: { trustedPeerCount: number; peerCount: number };
      }>(outputPath);

      expect(updated.trust.peers.trusted).toBe(1);
      expect(updated.trust.peers.quarantined).toBe(1);
      expect(updated.summary.trustedPeerCount).toBe(1);
      expect(updated.summary.peerCount).toBe(3);
      expect(fetchMock).toHaveBeenCalled();
    } finally {
      stop();
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});