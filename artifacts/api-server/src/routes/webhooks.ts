import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod/v4";
import { db, sitesTable, webhooksTable, webhookDeliveriesTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { asyncHandler, AppError } from "../lib/errors";
import { deliverWebhook } from "../lib/webhooks";
import { webhookLimiter, writeLimiter } from "../middleware/rateLimiter";

const router: IRouter = Router();

const ALLOWED_EVENTS = ["deploy", "deploy_failed", "form_submission", "site_down", "site_recovered", "node_offline", "node_online"] as const;

const WebhookBody = z.object({
  url:     z.string().url("Must be a valid HTTPS URL").refine((u: string) => u.startsWith("https://"), "Webhook URL must use HTTPS"),
  secret:  z.string().max(256).optional(),
  events:  z.union([z.literal("*"), z.array(z.enum(ALLOWED_EVENTS)).min(1)]).default("*"),
  enabled: z.boolean().default(true),
});

async function requireSiteOwner(req: Request, siteId: number) {
  if (!req.isAuthenticated()) throw AppError.unauthorized();
  const [site] = await db.select({ ownerId: sitesTable.ownerId }).from(sitesTable).where(eq(sitesTable.id, siteId));
  if (!site) throw AppError.notFound("Site not found");
  if (site.ownerId !== req.user.id) throw AppError.forbidden();
}

// ── Webhook CRUD ──────────────────────────────────────────────────────────────

router.get("/sites/:id/webhooks", asyncHandler(async (req: Request, res: Response) => {
  const siteId = parseInt(req.params.id as string, 10);
  if (isNaN(siteId)) throw AppError.badRequest("Invalid site ID");
  await requireSiteOwner(req, siteId);
  const hooks = await db.select().from(webhooksTable).where(eq(webhooksTable.siteId, siteId)).orderBy(webhooksTable.createdAt);
  res.json(hooks.map(h => ({ ...h, secret: h.secret ? "***" : null })));
}));

router.post("/sites/:id/webhooks", writeLimiter, asyncHandler(async (req: Request, res: Response) => {
  const siteId = parseInt(req.params.id as string, 10);
  if (isNaN(siteId)) throw AppError.badRequest("Invalid site ID");
  await requireSiteOwner(req, siteId);
  const parsed = WebhookBody.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest(parsed.error.message);
  const events = Array.isArray(parsed.data.events) ? parsed.data.events.join(",") : parsed.data.events;
  const [hook] = await db.insert(webhooksTable).values({ siteId, url: parsed.data.url, secret: parsed.data.secret ?? null, events, enabled: parsed.data.enabled ? 1 : 0 }).returning();
  res.status(201).json({ ...hook, secret: hook.secret ? "***" : null });
}));

router.patch("/sites/:id/webhooks/:hookId", writeLimiter, asyncHandler(async (req: Request, res: Response) => {
  const siteId = parseInt(req.params.id as string, 10);
  const hookId = parseInt(req.params.hookId as string, 10);
  if (isNaN(siteId) || isNaN(hookId)) throw AppError.badRequest("Invalid ID");
  await requireSiteOwner(req, siteId);
  const parsed = WebhookBody.partial().safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest(parsed.error.message);
  const updates: Record<string, unknown> = {};
  if (parsed.data.url     !== undefined) updates.url     = parsed.data.url;
  if (parsed.data.secret  !== undefined) updates.secret  = parsed.data.secret;
  if (parsed.data.enabled !== undefined) updates.enabled = parsed.data.enabled ? 1 : 0;
  if (parsed.data.events  !== undefined) updates.events  = Array.isArray(parsed.data.events) ? parsed.data.events.join(",") : parsed.data.events;
  const [updated] = await db.update(webhooksTable).set(updates).where(and(eq(webhooksTable.id, hookId), eq(webhooksTable.siteId, siteId))).returning();
  if (!updated) throw AppError.notFound("Webhook not found");
  res.json({ ...updated, secret: updated.secret ? "***" : null });
}));

router.delete("/sites/:id/webhooks/:hookId", writeLimiter, asyncHandler(async (req: Request, res: Response) => {
  const siteId = parseInt(req.params.id as string, 10);
  const hookId = parseInt(req.params.hookId as string, 10);
  if (isNaN(siteId) || isNaN(hookId)) throw AppError.badRequest("Invalid ID");
  await requireSiteOwner(req, siteId);
  await db.delete(webhooksTable).where(and(eq(webhooksTable.id, hookId), eq(webhooksTable.siteId, siteId)));
  res.sendStatus(204);
}));

/**
 * GET /api/webhooks/config
 * Returns current webhook configuration (URLs redacted for security).
 */
router.get("/webhooks/config", asyncHandler(async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();

  const raw = process.env.WEBHOOK_URLS ?? "";
  const urls = raw
    .split(",")
    .map((u) => u.trim())
    .filter((u) => u.startsWith("http"));

  // Redact credentials from URLs before returning
  const redacted = urls.map((u) => {
    try {
      const parsed = new URL(u);
      if (parsed.password) parsed.password = "***";
      if (parsed.username) parsed.username = parsed.username.slice(0, 3) + "***";
      return parsed.toString();
    } catch {
      return u.slice(0, 30) + "…";
    }
  });

  res.json({
    configured: urls.length > 0,
    count: urls.length,
    urls: redacted,
    events: [
      "node_offline",
      "node_online",
      "deploy",
      "deploy_failed",
      "new_peer",
    ],
    signingInfo: "Each delivery is signed with X-FedHost-Signature (Ed25519). Verify against your node's public key from /.well-known/federation",
  });
}));

/**
 * POST /api/webhooks/test
 * Send a test payload to all configured webhook URLs.
 */
router.post("/webhooks/test", webhookLimiter, asyncHandler(async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();

  const raw = process.env.WEBHOOK_URLS ?? "";
  const urls = raw.split(",").map((u) => u.trim()).filter((u) => u.startsWith("http"));

  if (urls.length === 0) {
    throw AppError.badRequest(
      "No webhook URLs configured. Set the WEBHOOK_URLS environment variable.",
      "NO_WEBHOOKS_CONFIGURED",
    );
  }

  await deliverWebhook({
    event: "deploy",
    timestamp: new Date().toISOString(),
    siteId: 0,
    siteDomain: "test.fedhosting.network",
    deploymentId: 0,
    version: 1,
    fileCount: 3,
    meta: { test: true, triggeredBy: req.user?.id },
  });

  res.json({
    sent: true,
    targets: urls.length,
    message: "Test webhook delivered to all configured URLs. Check your endpoint logs.",
  });
}));

/**
 * GET /api/sites/:id/webhooks/:hookId/deliveries
 * Last 50 delivery attempts for a webhook, newest first.
 * Useful for debugging failed deliveries and retry status.
 */
router.get("/sites/:id/webhooks/:hookId/deliveries", asyncHandler(async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();
  const siteId  = parseInt(req.params.id     as string, 10);
  const hookId  = parseInt(req.params.hookId as string, 10);
  if (isNaN(siteId) || isNaN(hookId)) throw AppError.badRequest("Invalid ID");

  const [site] = await db.select({ ownerId: sitesTable.ownerId })
    .from(sitesTable).where(eq(sitesTable.id, siteId));
  if (!site) throw AppError.notFound("Site not found");
  if (site.ownerId !== req.user.id) throw AppError.forbidden();

  const { webhookDeliveriesTable } = await import("@workspace/db");
  const { desc: descOp } = await import("drizzle-orm");

  const deliveries = await db.select().from(webhookDeliveriesTable)
    .where(eq(webhookDeliveriesTable.webhookId, hookId))
    .orderBy(descOp(webhookDeliveriesTable.createdAt))
    .limit(50);

  res.json(deliveries);
}));

export default router;
