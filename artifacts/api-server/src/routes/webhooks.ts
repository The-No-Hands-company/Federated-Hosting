import { Router, type IRouter, type Request, type Response } from "express";
import { asyncHandler, AppError } from "../lib/errors";
import { deliverWebhook } from "../lib/webhooks";
import { webhookLimiter } from "../middleware/rateLimiter";

const router: IRouter = Router();

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
