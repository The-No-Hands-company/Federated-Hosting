/**
 * Nexus Systems API — registration contract helpers for Nexus-Hosting.
 *
 * Non-disruptive: this file adds the shared systems-api contract shape used
 * by the ecosystem orchestrator without touching any existing server code.
 * The active Cloud integration lives in ./lib/nexusCloudClient.ts.
 */

export type SystemsApiRegistrationPayload = {
  id: string;
  mode: "standalone" | "embedded";
  exposed: boolean;
  upstreamUrl: string;
  capabilities: string[];
  metadata: Record<string, unknown>;
};

/**
 * Builds the canonical Nexus Systems API registration payload for Nexus-Hosting.
 *
 * @param upstreamUrl - The reachable URL of this hosting node (e.g. "http://localhost:8080")
 */
export function buildSystemsApiRegistrationPayload(
  upstreamUrl: string,
): SystemsApiRegistrationPayload {
  return {
    id: "nexus-hosting",
    mode: "standalone",
    exposed: true,
    upstreamUrl,
    capabilities: [
      "federated-site-hosting",
      "custom-domain-management",
      "acme-tls-provisioning",
      "object-storage-proxy",
      "gossip-federation",
      "site-health-monitoring",
      "analytics-flusher",
      "webhook-delivery",
    ],
    metadata: {
      hostingVersion: "v1",
      supportsFederatedHosting: true,
      supportsCustomDomains: true,
      supportsAcmeTls: true,
      supportsObjectStorage: true,
      supportsGossipFederation: true,
    },
  };
}
