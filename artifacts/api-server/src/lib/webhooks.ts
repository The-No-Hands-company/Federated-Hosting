/**
 * Webhook notification system with delivery log and retry queue.
 *
 * Events:
 *   node_offline, node_online, deploy, deploy_failed, new_peer,
 *   form_submission, site_down, site_recovered
 *
 * Webhooks can be registered:
 *   - Per-node: WEBHOOK_URLS env var (comma-separated)
 *   - Per-site: stored in webhooks table
 *
 * Each delivery is Ed25519-signed. Failed deliveries are retried with
 * exponential backoff (1m → 5m → 15m → 1h → 6h). After 5 failures,
 * the delivery is marked permanently failed.
 *
 * Delivery history is stored in webhook_deliveries for audit/debugging.
 * GET /api/sites/:id/webhooks/:hookId/deliveries — last 50 deliveries
 */

import { db, nodesTable, webhooksTable, webhookDeliveriesTable } from "@workspace/db";
import { eq, and, lte, lt, isNull } from "drizzle-orm";
import { signMessage } from "./federation";
import logger from "./logger";

export type WebhookEventType =
  | "node_offline" | "node_online" | "deploy" | "deploy_failed"
  | "new_peer" | "form_submission" | "site_down" | "site_recovered";

export interface WebhookPayload {
  event: WebhookEventType;
  timestamp: string;
  nodeId?: number;
  nodeDomain?: string;
  siteId?: number;
  siteDomain?: string;
  deploymentId?: number;
  version?: number;
  [key: string]: unknown;
}

// Retry backoff in milliseconds: 1m, 5m, 15m, 1h, 6h
const RETRY_DELAYS = [60_000, 300_000, 900_000, 3_600_000, 21_600_000];
const MAX_ATTEMPTS = RETRY_DELAYS.length + 1;

async function attemptDelivery(
  url: string,
  secret: string | null,
  payload: WebhookPayload,
  signature: string,
): Promise<{ success: boolean; statusCode: number | null; response: string; durationMs: number }> {
  const body = JSON.stringify(payload);
  const start = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-NexusHosting-Event": payload.event,
        "X-NexusHosting-Signature": signature,
        "X-NexusHosting-Timestamp": payload.timestamp,
        ...(secret ? { "X-Webhook-Secret": secret } : {}),
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    const text = await res.text().catch(() => "");
    return {
      success: res.ok,
      statusCode: res.status,
      response: text.slice(0, 500),
      durationMs: Date.now() - start,
    };
  } catch (err: any) {
    return {
      success: false,
      statusCode: null,
      response: err.message ?? "Network error",
      durationMs: Date.now() - start,
    };
  }
}

/**
 * Deliver a webhook to all registered endpoints for a site,
 * logging each attempt and scheduling retries on failure.
 */
export async function deliverWebhook(payload: WebhookPayload): Promise<void> {
  const [localNode] = await db.select().from(nodesTable).where(eq(nodesTable.isLocalNode, 1));
  const signature = localNode?.privateKey
    ? signMessage(localNode.privateKey, JSON.stringify(payload))
    : "unsigned";

  // ── Per-site webhook URLs from DB ────────────────────────────────────────
  const siteHooks = payload.siteId
    ? await db.select().from(webhooksTable)
        .where(and(eq(webhooksTable.siteId, payload.siteId), eq(webhooksTable.enabled, 1)))
    : [];

  for (const hook of siteHooks) {
    const result = await attemptDelivery(hook.url, hook.secret, payload, signature);

    const [delivery] = await db.insert(webhookDeliveriesTable).values({
      webhookId:  hook.id,
      event:      payload.event,
      payload:    payload as any,
      statusCode: result.statusCode,
      response:   result.response,
      durationMs: result.durationMs,
      attempt:    1,
      success:    result.success ? 1 : 0,
      nextRetry:  result.success ? null : new Date(Date.now() + RETRY_DELAYS[0]!),
    }).returning({ id: webhookDeliveriesTable.id });

    if (result.success) {
      logger.debug({ url: hook.url, event: payload.event }, "[webhook] Delivered");
    } else {
      logger.warn({ url: hook.url, event: payload.event, status: result.statusCode }, "[webhook] Failed — queued for retry");
    }
  }

  // ── Global node-level URLs from env ──────────────────────────────────────
  const envUrls = (process.env.WEBHOOK_URLS ?? "").split(",").map(u => u.trim()).filter(Boolean);
  for (const url of envUrls) {
    const result = await attemptDelivery(url, null, payload, signature);
    if (!result.success) {
      logger.warn({ url, event: payload.event }, "[webhook] Env webhook failed");
    }
  }
}

/**
 * Process pending webhook retries. Called on a schedule (every 60s).
 */
export async function processWebhookRetries(): Promise<void> {
  const due = await db.select({
    id:        webhookDeliveriesTable.id,
    webhookId: webhookDeliveriesTable.webhookId,
    payload:   webhookDeliveriesTable.payload,
    attempt:   webhookDeliveriesTable.attempt,
  })
    .from(webhookDeliveriesTable)
    .where(
      and(
        eq(webhookDeliveriesTable.success, 0),
        lte(webhookDeliveriesTable.nextRetry, new Date()),
        lt(webhookDeliveriesTable.attempt, MAX_ATTEMPTS),
      )
    )
    .limit(50);

  if (due.length === 0) return;

  const [localNode] = await db.select().from(nodesTable).where(eq(nodesTable.isLocalNode, 1));

  for (const delivery of due) {
    const [hook] = await db.select().from(webhooksTable).where(eq(webhooksTable.id, delivery.webhookId));
    if (!hook || !hook.enabled) {
      // Webhook was deleted or disabled — mark done
      await db.update(webhookDeliveriesTable)
        .set({ success: 1, response: "Webhook disabled" })
        .where(eq(webhookDeliveriesTable.id, delivery.id));
      continue;
    }

    const payload = delivery.payload as WebhookPayload;
    const signature = localNode?.privateKey
      ? signMessage(localNode.privateKey, JSON.stringify(payload))
      : "unsigned";

    const nextAttempt = delivery.attempt + 1;
    const result = await attemptDelivery(hook.url, hook.secret, payload, signature);

    await db.update(webhookDeliveriesTable).set({
      attempt:    nextAttempt,
      statusCode: result.statusCode,
      response:   result.response,
      durationMs: result.durationMs,
      success:    result.success ? 1 : 0,
      nextRetry:  result.success || nextAttempt >= MAX_ATTEMPTS
        ? null
        : new Date(Date.now() + (RETRY_DELAYS[nextAttempt - 1] ?? RETRY_DELAYS[RETRY_DELAYS.length - 1]!)),
    }).where(eq(webhookDeliveriesTable.id, delivery.id));

    logger.info({
      deliveryId: delivery.id,
      attempt: nextAttempt,
      success: result.success,
      url: hook.url,
    }, "[webhook] Retry processed");
  }
}

let retryTimer: NodeJS.Timeout | null = null;

export function startWebhookRetryProcessor(): void {
  retryTimer = setInterval(() => {
    processWebhookRetries().catch(err => logger.warn({ err }, "[webhook] Retry processor error"));
  }, 60_000);
  logger.info("[webhook] Retry processor started");
}

export function stopWebhookRetryProcessor(): void {
  if (retryTimer) { clearInterval(retryTimer); retryTimer = null; }
}

// ── Convenience wrappers ──────────────────────────────────────────────────────
export const notifyDeploy = (opts: { siteId: number; siteDomain: string; deploymentId: number; version: number }) =>
  deliverWebhook({ event: "deploy", timestamp: new Date().toISOString(), ...opts }).catch(() => {});

export const notifyDeployFailed = (opts: { siteId: number; siteDomain: string; error: string }) =>
  deliverWebhook({ event: "deploy_failed", timestamp: new Date().toISOString(), ...opts }).catch(() => {});

export const notifySiteDown = (opts: { siteId: number; siteDomain: string }) =>
  deliverWebhook({ event: "site_down", timestamp: new Date().toISOString(), ...opts }).catch(() => {});

export const notifySiteRecovered = (opts: { siteId: number; siteDomain: string }) =>
  deliverWebhook({ event: "site_recovered", timestamp: new Date().toISOString(), ...opts }).catch(() => {});

export const notifyNewPeer = (opts: { nodeDomain: string }) =>
  deliverWebhook({ event: "new_peer", timestamp: new Date().toISOString(), ...opts }).catch(() => {});
