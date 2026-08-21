import { Router, type IRouter, type Request, type Response } from "express";
import { asyncHandler, AppError } from "../lib/errors";
import { requireScope } from "../middleware/tokenAuth";
import logger from "../lib/logger";

const router: IRouter = Router();

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

export type NexusCloudDiscoveryPayload = {
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

export const CLOUD_COMPONENTS = [
  {
    id: "nexus-cloud",
    name: "Nexus Cloud",
    role: "control-plane",
    mode: "embedded",
    exposes: ["/.well-known/nexus-cloud", "/cloud/register", "/cloud/discovery", "/cloud/client"],
    consumes: ["/api/v1/tools", "/api/v1/status", "/api/v1/public-url", "/api/v1/deployments"],
    embedded: true,
    referenced: true,
    requiredApis: ["systems-api.v1", "deploy.integration", "topology.v1"],
  },
  {
    id: "nexus-hosting",
    name: "Nexus Hosting",
    role: "hosting-node",
    mode: "embedded",
    exposes: ["/.well-known/federation", "/cloud/register"],
    consumes: ["/api/v1/topology", "/api/v1/apps", "/api/v1/connections"],
    embedded: false,
    referenced: true,
    requiredApis: ["topology.v1", "systems-api.v1"],
  },
  {
    id: "nexus-ai",
    name: "Nexus AI",
    role: "agent-layer",
    mode: "referenced",
    exposes: ["/cloud/register"],
    consumes: ["/api/v1/tools", "/api/v1/status"],
    embedded: false,
    referenced: true,
    requiredApis: ["systems-api.v1"],
  },
  {
    id: "nexus-computer",
    name: "Nexus Computer",
    role: "edge-runtime",
    mode: "referenced",
    exposes: ["/cloud/register"],
    consumes: ["/api/v1/status", "/api/v1/apps"],
    embedded: false,
    referenced: true,
    requiredApis: ["systems-api.v1", "topology.v1"],
  },
  {
    id: "nexus-deploy",
    name: "Nexus Deploy",
    role: "deployment-engine",
    mode: "referenced",
    exposes: ["/api/v1/deployments"],
    consumes: ["/api/v1/tools", "/api/v1/status"],
    embedded: false,
    referenced: true,
    requiredApis: ["systems-api.v1", "deploy.integration"],
  },
  {
    id: "nexus-vault",
    name: "Nexus Vault",
    role: "secrets-layer",
    mode: "referenced",
    exposes: ["/cloud/register"],
    consumes: ["/api/v1/status", "/api/v1/connections"],
    embedded: false,
    referenced: true,
    requiredApis: ["systems-api.v1"],
  },
  {
    id: "nexus-network",
    name: "Nexus Network",
    role: "mesh-layer",
    mode: "referenced",
    exposes: ["/.well-known/federation"],
    consumes: ["/api/v1/topology", "/api/v1/connections"],
    embedded: false,
    referenced: true,
    requiredApis: ["topology.v1", "systems-api.v1"],
  },
  {
    id: "nexus-hosting-platform",
    name: "Nexus Hosting Platform",
    role: "hosting-layer",
    mode: "embedded",
    exposes: ["/.well-known/federation", "/cloud/register", "/cloud/discovery", "/cloud/client"],
    consumes: ["/api/v1/topology", "/api/v1/apps", "/api/v1/connections"],
    embedded: true,
    referenced: true,
    requiredApis: ["systems-api.v1", "topology.v1", "deploy.integration"],
  },
] as const satisfies readonly NexusCloudDiscoveryApp[];

export function buildNexusCloudDiscoveryPayload(): NexusCloudDiscoveryPayload {
  return {
    protocol: "nexus-cloud/1.0",
    hub: "Nexus Cloud",
    apps: CLOUD_COMPONENTS,
    updatedAt: new Date().toISOString(),
  };
}

export function buildNexusCloudClientContract(): { client: NexusCloudClientContract } {
  return {
    client: {
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
    },
  };
}

export function buildNexusCloudRegistrationResponse(input: NexusCloudRegistrationRequest): NexusCloudRegistrationResponse {
  return {
    registered: true,
    appId: input.appId,
    nodeId: input.nodeId,
    endpoint: input.endpoint,
    secretHint: typeof input.secret === "string" ? `${input.secret.slice(0, 4)}...` : null,
    capabilities: Array.isArray(input.capabilities) ? input.capabilities : [],
    registry: "/cloud/discovery",
    client: "/cloud/client",
    connectedTo: "Nexus Cloud",
  };
}

// globalThis.Response, not Express's Response — both names are in scope here
// and the annotation was resolving to the Express one, which this does not
// return.
function json(data: unknown, status = 200): globalThis.Response {
  return globalThis.Response.json(data, { status });
}

router.get("/.well-known/nexus-cloud", asyncHandler(async (_req: Request, res: Response) => {
  res.json({
    protocol: "nexus-cloud/1.0",
    hub: "Nexus Cloud",
    version: "1.0.0",
    topology: "/cloud/discovery",
    register: "/cloud/register",
    client: "/cloud/client",
    capabilities: ["topology", "registration", "discovery", "client-contracts"],
  });
}));

router.get("/cloud/discovery", asyncHandler(async (_req: Request, res: Response) => {
  res.json(buildNexusCloudDiscoveryPayload());
}));

router.post("/cloud/register", requireScope("deploy"), asyncHandler(async (req: Request, res: Response) => {
  const { appId, nodeId, endpoint } = req.body ?? {};
  if (!appId || !nodeId || !endpoint) {
    throw AppError.badRequest("Missing required fields: appId, nodeId, endpoint");
  }

  logger.info({ appId, nodeId }, "[cloud] App registration received");

  res.status(201).json(buildNexusCloudRegistrationResponse(req.body as NexusCloudRegistrationRequest));
}));

router.get("/cloud/client", asyncHandler(async (_req: Request, res: Response) => {
  res.json(buildNexusCloudClientContract());
}));

export default router;
