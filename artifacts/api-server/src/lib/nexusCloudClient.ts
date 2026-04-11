export type NexusCloudDiscoveryApp = {
  id: string;
  name: string;
  role: string;
  mode: string;
  exposes: readonly string[];
  consumes: readonly string[];
  embedded: boolean;
  referenced: boolean;
  requiredApis: readonly string[];
};

export type NexusCloudDiscoveryResponse = {
  protocol: string;
  hub: string;
  apps: readonly NexusCloudDiscoveryApp[];
  updatedAt: string;
};

export type NexusCloudRegistrationRequest = {
  appId: string;
  nodeId: string;
  endpoint: string;
  secret?: string;
  capabilities?: readonly string[];
};

export type NexusCloudRegistrationResponse = {
  registered: boolean;
  appId: string;
  nodeId: string;
  endpoint: string;
  secretHint: string | null;
  capabilities: readonly string[];
  registry: string;
  client: string;
  connectedTo: string;
};

export type NexusCloudClientContract = {
  name: string;
  baseUrl: string;
  auth: string;
  endpoints: {
    topology: string;
    apps: string;
    connections: string;
    summary: string;
  };
  headers: readonly string[];
};

// ─── Systems API v1 registration (current Cloud protocol) ────────────────────
// POST /api/v1/tools — registers this Hosting node as a tool with Nexus Cloud,
// enabling subdomain issuance, TLS, and reverse-proxy routing.

export type NexusCloudToolRegistrationRequest = {
  /** Tool ID — stable identifier, used in heartbeats and routing table */
  id: string;
  name: string;
  description: string;
  /** The public URL of this Hosting node — used by Cloud's reverse proxy */
  upstreamUrl?: string;
  mode?: "standalone" | "orchestrated";
  exposed?: boolean;
  health?: "healthy" | "degraded" | "offline";
  capabilities?: readonly string[];
};

/**
 * Register (or upsert) this Hosting node as a tool in Nexus Cloud.
 * Uses the current Systems API v1 protocol: POST /api/v1/tools
 * API key is passed as X-Api-Key header.
 */
export async function registerToolWithCloud(
  cloudBaseUrl: string,
  payload: NexusCloudToolRegistrationRequest,
  apiKey: string,
): Promise<void> {
  const res = await fetch(`${cloudBaseUrl.replace(/\/$/, "")}/api/v1/tools`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(apiKey ? { "X-Api-Key": apiKey } : {}),
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Nexus Cloud tool registration failed: ${res.status}`);
  }
}

/**
 * Send a liveness heartbeat to Nexus Cloud.
 * POST /api/v1/tools/:toolId/heartbeat
 */
export async function sendToolHeartbeat(
  cloudBaseUrl: string,
  toolId: string,
  apiKey: string,
  upstreamUrl?: string,
): Promise<void> {
  const res = await fetch(
    `${cloudBaseUrl.replace(/\/$/, "")}/api/v1/tools/${encodeURIComponent(toolId)}/heartbeat`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(apiKey ? { "X-Api-Key": apiKey } : {}),
      },
      body: JSON.stringify({ health: "healthy", ...(upstreamUrl ? { upstreamUrl } : {}) }),
    },
  );
  if (!res.ok) {
    throw new Error(`Nexus Cloud heartbeat failed: ${res.status}`);
  }
}

// ─── Legacy helpers (kept for backwards compat with existing tests) ───────────

export async function fetchNexusCloudDiscovery(baseUrl: string): Promise<NexusCloudDiscoveryResponse> {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/.well-known/nexus-cloud`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch Nexus Cloud discovery: ${res.status}`);
  }
  return res.json() as Promise<NexusCloudDiscoveryResponse>;
}

export async function registerWithNexusCloud(baseUrl: string, body: NexusCloudRegistrationRequest, bearerToken: string): Promise<NexusCloudRegistrationResponse> {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/cloud/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${bearerToken}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Failed to register with Nexus Cloud: ${res.status}`);
  }
  return res.json() as Promise<NexusCloudRegistrationResponse>;
}

export async function fetchNexusCloudClientContract(baseUrl: string): Promise<NexusCloudClientContract> {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/cloud/client`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch Nexus Cloud client contract: ${res.status}`);
  }
  const data = await res.json() as { client: NexusCloudClientContract };
  return data.client;
}
