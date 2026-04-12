/**
 * Email notification system.
 *
 * All emails go through a persistent queue (email_queue table) with
 * exponential backoff retry. SMTP failures never cause request failures.
 *
 * Queue processing runs every 30 seconds. Failed emails are retried up to
 * 5 times with delays: 1m → 5m → 15m → 1h → 6h. After 5 failures the
 * email is marked failed and never retried.
 */

import nodemailer, { type Transporter } from "nodemailer";
import { db, emailQueueTable } from "@workspace/db";
import { isNull, lte, lt, eq, sql } from "drizzle-orm";
import logger from "./logger";

// ── Transport ──────────────────────────────────────────────────────────────────

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  if (!host) return null;

  const port   = parseInt(process.env.SMTP_PORT ?? "587", 10);
  const secure = process.env.SMTP_SECURE === "true";

  transporter = nodemailer.createTransport({
    host, port, secure,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? "" } : undefined,
    pool: true, maxConnections: 5, maxMessages: 100,
  });

  return transporter;
}

function fromAddress(): string {
  const name   = process.env.EMAIL_FROM_NAME ?? "NexusHosting";
  const domain = process.env.PUBLIC_DOMAIN ?? "localhost";
  const addr   = process.env.EMAIL_FROM ?? `noreply@${domain}`;
  return `"${name}" <${addr}>`;
}

// Backoff delays per attempt (ms)
const BACKOFF = [60_000, 300_000, 900_000, 3_600_000, 21_600_000];

/** Enqueue an email. Returns immediately — actual sending is async. */
async function enqueue(opts: { to: string; subject: string; html: string; text: string }): Promise<void> {
  if (!process.env.SMTP_HOST) return; // email not configured, skip silently
  try {
    await db.insert(emailQueueTable).values(opts);
  } catch (err) {
    logger.error({ err, to: opts.to }, "[email] Failed to enqueue");
  }
}

/** Process pending emails from the queue. Called by the email flush job. */
export async function processEmailQueue(): Promise<void> {
  const t = getTransporter();
  if (!t) return;

  const pending = await db
    .select()
    .from(emailQueueTable)
    .where(sql`${emailQueueTable.sentAt} IS NULL AND ${emailQueueTable.failedAt} IS NULL AND ${emailQueueTable.nextAttempt} <= NOW()`)
    .limit(20);

  for (const item of pending) {
    try {
      await t.sendMail({ from: fromAddress(), to: item.to, subject: item.subject, html: item.html, text: item.text });

      await db.update(emailQueueTable)
        .set({ sentAt: new Date() })
        .where(eq(emailQueueTable.id, item.id));

      logger.info({ to: item.to, subject: item.subject }, "[email] Sent");
    } catch (err: any) {
      const attempts = item.attempts + 1;
      if (attempts >= item.maxAttempts) {
        await db.update(emailQueueTable)
          .set({ attempts, failedAt: new Date(), error: err.message })
          .where(eq(emailQueueTable.id, item.id));
        logger.error({ to: item.to, attempts }, "[email] Permanently failed");
      } else {
        const delay = BACKOFF[attempts - 1] ?? BACKOFF[BACKOFF.length - 1]!;
        const nextAttempt = new Date(Date.now() + delay);
        await db.update(emailQueueTable)
          .set({ attempts, nextAttempt, error: err.message })
          .where(eq(emailQueueTable.id, item.id));
        logger.warn({ to: item.to, attempts, nextAttemptIn: delay }, "[email] Retrying");
      }
    }
  }
}

// Queue flush timer
let emailTimer: NodeJS.Timeout | null = null;

export function startEmailQueue(): void {
  if (!process.env.SMTP_HOST) return;
  processEmailQueue().catch(() => {});
  emailTimer = setInterval(() => processEmailQueue().catch(() => {}), 30_000);
  logger.info("[email] Queue processor started");
}

export function stopEmailQueue(): void {
  if (emailTimer) { clearInterval(emailTimer); emailTimer = null; }
}

// sendMail is now just enqueue
export async function sendMail(opts: { to: string; subject: string; html: string; text: string }): Promise<boolean> {
  await enqueue(opts);
  return true;
}

// ── HTML layout ───────────────────────────────────────────────────────────────

function layout(content: string, title: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; background: #0a0a0f; color: #e4e4f0; margin: 0; padding: 40px 20px; }
  .wrap { max-width: 560px; margin: 0 auto; }
  .header { margin-bottom: 32px; }
  .logo { font-size: 1.4rem; font-weight: 800; color: #00e5ff; letter-spacing: -0.5px; }
  .card { background: #12121a; border: 1px solid rgba(255,255,255,.08); border-radius: 16px; padding: 32px; margin-bottom: 24px; }
  h1 { font-size: 1.3rem; font-weight: 700; margin: 0 0 8px; color: #fff; }
  p { margin: 0 0 16px; color: #9ca3af; line-height: 1.6; font-size: 0.9rem; }
  .btn { display: inline-block; padding: 12px 24px; background: #00e5ff; color: #000; text-decoration: none; border-radius: 8px; font-weight: 700; font-size: 0.9rem; }
  .meta { font-size: 0.8rem; color: #4b5563; margin-top: 8px; }
  .badge { display: inline-block; padding: 2px 10px; border-radius: 99px; font-size: 0.75rem; font-weight: 600; }
  .badge-green { background: rgba(34,197,94,.15); color: #4ade80; }
  .badge-red { background: rgba(239,68,68,.15); color: #f87171; }
  .badge-yellow { background: rgba(234,179,8,.15); color: #facc15; }
  .footer { font-size: 0.78rem; color: #374151; text-align: center; margin-top: 32px; }
</style>
</head>
<body>
<div class="wrap">
  <div class="header"><span class="logo">⚡ NexusHosting</span></div>
  ${content}
  <div class="footer">This email was sent by your NexusHosting node. If you did not expect this email, you can safely ignore it.</div>
</div>
</body>
</html>`;
}

// ── Email templates ───────────────────────────────────────────────────────────

export async function emailDeploySuccess(opts: {
  to: string;
  siteName: string;
  domain: string;
  version: number;
  fileCount: number;
  deployedAt: string;
}) {
  const subject = `✅ ${opts.siteName} deployed successfully`;
  const html = layout(`
    <div class="card">
      <h1>Deployment successful</h1>
      <p><strong style="color:#fff">${opts.siteName}</strong> (${opts.domain}) was deployed successfully.</p>
      <p class="meta">
        <span class="badge badge-green">v${opts.version}</span> &nbsp;
        ${opts.fileCount} files &nbsp;·&nbsp; ${opts.deployedAt}
      </p>
      <br>
      <a href="https://${opts.domain}" class="btn">View Live Site →</a>
    </div>
  `, subject);
  const text = `${opts.siteName} (${opts.domain}) deployed successfully.\nVersion: ${opts.version} · ${opts.fileCount} files\nView: https://${opts.domain}`;
  return sendMail({ to: opts.to, subject, html, text });
}

export async function emailDeployFailed(opts: {
  to: string;
  siteName: string;
  domain: string;
  error: string;
}) {
  const subject = `❌ Deployment failed for ${opts.siteName}`;
  const html = layout(`
    <div class="card">
      <h1>Deployment failed</h1>
      <p><strong style="color:#fff">${opts.siteName}</strong> (${opts.domain}) failed to deploy.</p>
      <p><strong style="color:#f87171">Error:</strong> <code style="background:#1a1a26;padding:2px 6px;border-radius:4px;font-size:.85rem">${opts.error}</code></p>
      <p>Check your deployment logs and try again. If the problem persists, contact your node operator.</p>
    </div>
  `, subject);
  const text = `${opts.siteName} failed to deploy.\nError: ${opts.error}`;
  return sendMail({ to: opts.to, subject, html, text });
}

export async function emailCertExpiring(opts: {
  to: string;
  domain: string;
  daysLeft: number;
  expiresAt: string;
}) {
  const subject = `⚠️ TLS certificate for ${opts.domain} expires in ${opts.daysLeft} days`;
  const html = layout(`
    <div class="card">
      <h1>Certificate expiring soon</h1>
      <p>The TLS certificate for <strong style="color:#fff">${opts.domain}</strong> expires in <strong style="color:#facc15">${opts.daysLeft} days</strong> (${opts.expiresAt}).</p>
      <p>If automatic renewal is enabled, it will renew within the next 24 hours. If not, renew manually via your node's admin panel or by running certbot.</p>
    </div>
  `, subject);
  const text = `TLS certificate for ${opts.domain} expires in ${opts.daysLeft} days (${opts.expiresAt}).`;
  return sendMail({ to: opts.to, subject, html, text });
}

export async function emailCertRenewed(opts: {
  to: string;
  domain: string;
  expiresAt: string;
}) {
  const subject = `🔒 TLS certificate renewed for ${opts.domain}`;
  const html = layout(`
    <div class="card">
      <h1>Certificate renewed</h1>
      <p>The TLS certificate for <strong style="color:#fff">${opts.domain}</strong> was renewed successfully.</p>
      <p class="meta">Valid until: ${opts.expiresAt}</p>
    </div>
  `, subject);
  const text = `TLS certificate for ${opts.domain} renewed. Valid until ${opts.expiresAt}.`;
  return sendMail({ to: opts.to, subject, html, text });
}

export async function emailNodeOffline(opts: {
  to: string;
  nodeName: string;
  nodeDomain: string;
  since: string;
}) {
  const subject = `🔴 Node offline: ${opts.nodeName}`;
  const html = layout(`
    <div class="card">
      <h1>Federation node offline</h1>
      <p><strong style="color:#fff">${opts.nodeName}</strong> (${opts.nodeDomain}) has been unreachable since <strong style="color:#f87171">${opts.since}</strong>.</p>
      <p>Sites hosted on this node may be unavailable. The node will be automatically removed from the federation after extended downtime.</p>
    </div>
  `, subject);
  const text = `Node ${opts.nodeName} (${opts.nodeDomain}) has been offline since ${opts.since}.`;
  return sendMail({ to: opts.to, subject, html, text });
}

export async function emailInvitation(opts: {
  to: string;
  inviterName: string;
  siteName: string;
  domain: string;
  role: string;
  acceptUrl: string;
}) {
  const subject = `You've been invited to collaborate on ${opts.siteName}`;
  const html = layout(`
    <div class="card">
      <h1>You've been invited</h1>
      <p><strong style="color:#fff">${opts.inviterName}</strong> has invited you to collaborate on <strong style="color:#fff">${opts.siteName}</strong> (${opts.domain}) as a <strong style="color:#00e5ff">${opts.role}</strong>.</p>
      <br>
      <a href="${opts.acceptUrl}" class="btn">Accept Invitation →</a>
      <p class="meta" style="margin-top:16px">This invitation expires in 7 days. If you don't have a NexusHosting account, you'll be prompted to create one.</p>
    </div>
  `, subject);
  const text = `${opts.inviterName} invited you to ${opts.siteName} (${opts.domain}) as ${opts.role}.\nAccept: ${opts.acceptUrl}`;
  return sendMail({ to: opts.to, subject, html, text });
}

export async function emailFormSubmission(opts: {
  to: string;
  siteName: string;
  domain: string;
  formName: string;
  data: Record<string, string>;
}) {
  const subject = `📬 New ${opts.formName} submission on ${opts.siteName}`;
  const rows = Object.entries(opts.data)
    .filter(([k]) => !k.startsWith("_"))
    .map(([k, v]) => `<tr><td style="padding:6px 12px;color:#9ca3af;border-right:1px solid rgba(255,255,255,.06)">${k}</td><td style="padding:6px 12px;color:#e4e4f0">${v}</td></tr>`)
    .join("");

  const html = layout(`
    <div class="card">
      <h1>New form submission</h1>
      <p>You received a new <strong style="color:#fff">${opts.formName}</strong> submission on <strong style="color:#fff">${opts.domain}</strong>.</p>
      <table style="width:100%;border-collapse:collapse;border:1px solid rgba(255,255,255,.06);border-radius:8px;overflow:hidden;margin-top:16px">
        ${rows}
      </table>
    </div>
  `, subject);
  const text = `New ${opts.formName} submission on ${opts.domain}:\n` +
    Object.entries(opts.data).filter(([k]) => !k.startsWith("_")).map(([k,v]) => `${k}: ${v}`).join("\n");
  return sendMail({ to: opts.to, subject, html, text });
}

export async function emailSiteDeleted(opts: {
  to: string;
  siteName: string;
  domain: string;
  deletedAt: string;
}) {
  const subject = `Site deleted: ${opts.domain}`;
  const html = layout(`
    <div class="card">
      <h1>Site deleted</h1>
      <p><strong style="color:#fff">${opts.siteName}</strong> (${opts.domain}) was permanently deleted on ${opts.deletedAt}.</p>
      <p>All associated files, deployments, and analytics data have been removed. This cannot be undone.</p>
    </div>
  `, subject);
  const text = `${opts.siteName} (${opts.domain}) was deleted on ${opts.deletedAt}.`;
  return sendMail({ to: opts.to, subject, html, text });
}
