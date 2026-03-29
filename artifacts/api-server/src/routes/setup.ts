/**
 * First-run detection endpoint.
 *
 * Called by the frontend on app load. Returns whether this node needs
 * initial setup (no local node record, no admin user, etc.) so the UI
 * can show the first-run wizard instead of the normal dashboard.
 *
 * GET /api/setup/status
 *
 * Response:
 *   { needsSetup: false }                        — node is configured
 *   { needsSetup: true, steps: Step[] }          — wizard needed
 *
 * Steps (in order):
 *   node_identity   — no local node record yet
 *   admin_user      — no admin user exists
 *   object_storage  — storage not reachable
 *   oidc_or_local   — no auth configured
 */

import { Router, type Request, type Response } from "express";
import { db, nodesTable, usersTable } from "@workspace/db";
import { eq, count } from "drizzle-orm";
import { asyncHandler } from "../lib/asyncHandler.js";
import logger from "../lib/logger.js";

const router = Router();

export interface SetupStep {
  id:          string;
  title:       string;
  description: string;
  complete:    boolean;
  docsUrl?:    string;
}

/** GET /api/setup/status — check if node needs first-run setup */
router.get("/setup/status", asyncHandler(async (_req: Request, res: Response) => {
  const steps: SetupStep[] = [];

  // ── Step 1: Local node identity ───────────────────────────────────────────
  const [localNode] = await db
    .select({ id: nodesTable.id, name: nodesTable.name, domain: nodesTable.domain })
    .from(nodesTable)
    .where(eq(nodesTable.isLocalNode, 1))
    .limit(1);

  steps.push({
    id:          "node_identity",
    title:       "Node identity",
    description: "Your node needs a name, domain, and Ed25519 key pair to participate in the federation.",
    complete:    !!localNode?.domain && !!localNode?.name,
    docsUrl:     "https://github.com/The-No-Hands-company/Nexus-Hosting/blob/main/docs/SELF_HOSTING.md#node-identity",
  });

  // ── Step 2: Admin user ─────────────────────────────────────────────────────
  const [adminCount] = await db
    .select({ n: count() })
    .from(usersTable)
    .where(eq(usersTable.isAdmin, 1));

  steps.push({
    id:          "admin_user",
    title:       "Admin account",
    description: "Set ADMIN_USER_IDS in your .env or promote a user via the database to enable the admin panel.",
    complete:    (adminCount?.n ?? 0) > 0,
    docsUrl:     "https://github.com/The-No-Hands-company/Nexus-Hosting/blob/main/docs/SELF_HOSTING.md#admin",
  });

  // ── Step 3: Object storage reachable ──────────────────────────────────────
  const storageConfigured =
    !!(process.env.OBJECT_STORAGE_ENDPOINT) &&
    !!(process.env.OBJECT_STORAGE_ACCESS_KEY) &&
    !!(process.env.OBJECT_STORAGE_SECRET_KEY);

  steps.push({
    id:          "object_storage",
    title:       "Object storage",
    description: "Configure S3-compatible object storage (MinIO is bundled in Docker Compose).",
    complete:    storageConfigured,
    docsUrl:     "https://github.com/The-No-Hands-company/Nexus-Hosting/blob/main/docs/SELF_HOSTING.md#object-storage",
  });

  // ── Step 4: Auth configured ───────────────────────────────────────────────
  const oidcConfigured  = !!(process.env.ISSUER_URL && process.env.OIDC_CLIENT_ID);
  const localAuthEnabled = process.env.LOCAL_AUTH_ENABLED !== "false";

  steps.push({
    id:          "auth",
    title:       "Authentication",
    description: oidcConfigured
      ? "OIDC is configured."
      : localAuthEnabled
        ? "Local email+password auth is active. Optionally add OIDC for SSO."
        : "Configure OIDC (Authentik/Keycloak/Auth0) or enable local auth (LOCAL_AUTH_ENABLED=true).",
    complete:    oidcConfigured || localAuthEnabled,
    docsUrl:     "https://github.com/The-No-Hands-company/Nexus-Hosting/blob/main/docs/SELF_HOSTING.md#auth",
  });

  const needsSetup = steps.some(s => !s.complete);

  if (needsSetup) {
    logger.info(
      { incomplete: steps.filter(s => !s.complete).map(s => s.id) },
      "[setup] Node needs first-run configuration"
    );
  }

  res.json({ needsSetup, steps });
}));

/** POST /api/setup/node-identity — save node name + domain, generate keys */
router.post("/setup/node-identity", asyncHandler(async (req: Request, res: Response) => {
  const { name, domain, region, operatorName, operatorEmail, storageCapacityGb } = req.body as {
    name: string; domain: string; region?: string;
    operatorName?: string; operatorEmail?: string; storageCapacityGb?: number;
  };

  if (!name?.trim() || !domain?.trim()) {
    res.status(400).json({ error: "name and domain are required" });
    return;
  }

  const { generateKeyPair } = await import("../lib/federation.js");
  const { publicKey, privateKey } = generateKeyPair();

  const [existing] = await db
    .select({ id: nodesTable.id })
    .from(nodesTable)
    .where(eq(nodesTable.isLocalNode, 1))
    .limit(1);

  if (existing) {
    await db.update(nodesTable).set({
      name: name.trim(),
      domain: domain.trim().toLowerCase(),
      region: region ?? "unknown",
      operatorName: operatorName ?? "Node Operator",
      operatorEmail: operatorEmail ?? "",
      storageCapacityGb: storageCapacityGb ?? 100,
    }).where(eq(nodesTable.id, existing.id));
  } else {
    await db.insert(nodesTable).values({
      name: name.trim(),
      domain: domain.trim().toLowerCase(),
      region: region ?? "unknown",
      publicKey,
      privateKey,
      operatorName: operatorName ?? "Node Operator",
      operatorEmail: operatorEmail ?? "",
      storageCapacityGb: storageCapacityGb ?? 100,
      bandwidthCapacityGb: 1000,
      isLocalNode: 1,
      status: "active",
    });
  }

  res.json({ ok: true, publicKey });
}));

export default router;
