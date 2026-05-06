import { afterEach, describe, it, expect, vi } from "vitest";
import { fetchCloudTrustSummary, fetchNexusCloudDiscovery, fetchNexusCloudClientContract } from "../../src/lib/nexusCloudClient";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Nexus Cloud integration client contracts", () => {
  it("normalizes the discovery payload contract", () => {
    const payload = {
      protocol: "nexus-cloud/1.0",
      hub: "Nexus Cloud",
      apps: [
        {
          id: "nexus-hosting",
          name: "Nexus Hosting",
          role: "hosting-node",
          mode: "embedded",
          exposes: ["/.well-known/federation"],
          consumes: ["/api/v1/topology"],
          embedded: false,
          referenced: true,
          requiredApis: ["systems-api.v1"],
        },
      ],
      updatedAt: new Date().toISOString(),
    };

    expect(payload.protocol).toBe("nexus-cloud/1.0");
    expect(payload.apps[0]?.requiredApis).toContain("systems-api.v1");
  });

  it("documents the client contract shape", () => {
    const client = {
      name: "Nexus Cloud client",
      baseUrl: "/api",
      auth: "Bearer fh_*",
      endpoints: {
        topology: "/api/v1/topology",
        apps: "/api/v1/apps",
        connections: "/api/v1/connections",
        summary: "/api/v1/summary",
      },
      headers: ["Accept: application/json", "Authorization: Bearer <token>"],
    };

    expect(client.endpoints.topology).toBe("/api/v1/topology");
    expect(client.headers).toContain("Accept: application/json");
  });

  it("prefers compact trust mode and falls back to trust summary endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch" as any)
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "unsupported" }), { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        scope: "trust-lifecycle",
        trust: {
          nodes: { total: 2, pending: 0, verified: 1, trusted: 1, quarantined: 0, revoked: 0, expired: 0 },
          peers: { total: 3, pending: 0, verified: 1, trusted: 2, quarantined: 0, revoked: 0, expired: 0 },
          updatedAt: new Date().toISOString(),
        },
      }), { status: 200 }));

    const trust = await fetchCloudTrustSummary("https://cloud.example.com", "api-key");

    expect(trust.peers.trusted).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/api/v1/status?compact=trust");
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/api/v1/trust/summary");
  });

  it("uses compact trust mode when available", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch" as any)
      .mockResolvedValueOnce(new Response(JSON.stringify({
        scope: "trust-lifecycle",
        trust: {
          nodes: { total: 1, pending: 0, verified: 0, trusted: 1, quarantined: 0, revoked: 0, expired: 0 },
          peers: { total: 1, pending: 0, verified: 0, trusted: 1, quarantined: 0, revoked: 0, expired: 0 },
          updatedAt: new Date().toISOString(),
        },
      }), { status: 200 }));

    const trust = await fetchCloudTrustSummary("https://cloud.example.com", "api-key");

    expect(trust.nodes.trusted).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/api/v1/status?compact=trust");
  });
});
