/**
 * Admin audit log.
 *
 * Records every privileged action taken by an operator or admin.
 * Stored in the `admin_audit_log` database table.
 *
 * Every entry captures:
 *   - who:    actor user ID + email
 *   - what:   action name (e.g. "node.settings.update")
 *   - target: affected resource (e.g. { type: "node", id: 1 })
 *   - diff:   what changed (before/after values, with sensitive fields redacted)
 *   - meta:   request IP, user-agent, timestamp
 *
 * Usage:
 *   await auditLog(req, "site.delete", { type: "site", id: site.id }, { domain: site.domain });
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import type { Request } from "express";
import logger from "./logger";

export interface AuditTarget {
  type: "node" | "site" | "user" | "token" | "domain" | "system";
  id?: number | string;
}

export interface AuditLogEntry {
  actorId: string;
  actorEmail: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  metadata: Record<string, unknown>;
  ipAddress: string | null;
  userAgent: string | null;
}

// Fields that must never appear in audit diffs
const REDACTED_FIELDS = new Set([
  "password", "passwordHash", "token", "tokenHash", "privateKey",
  "secret", "accessKey", "secretKey", "apiKey", "cookie",
]);

function redactSensitive(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (REDACTED_FIELDS.has(k) || REDACTED_FIELDS.has(k.toLowerCase())) {
      out[k] = "[REDACTED]";
    } else if (v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = redactSensitive(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Record a privileged action in the audit log.
 *
 * @param req     Express request (for actor + IP extraction)
 * @param action  Dot-separated action name: "node.settings.update"
 * @param target  Affected resource
 * @param metadata  Additional context (before/after values, reason, etc.)
 */
export async function auditLog(
  req: Request,
  action: string,
  target: AuditTarget,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  const user = (req as any).user as { id: string; email?: string } | null;
  if (!user) return; // unauthenticated — shouldn't happen on admin routes

  const entry: AuditLogEntry = {
    actorId:    user.id,
    actorEmail: user.email ?? null,
    action,
    targetType: target.type,
    targetId:   target.id != null ? String(target.id) : null,
    metadata:   redactSensitive(metadata),
    ipAddress:  req.ip ?? req.socket.remoteAddress ?? null,
    userAgent:  req.headers["user-agent"] ?? null,
  };

  try {
    await db.execute(sql`
      INSERT INTO admin_audit_log
        (actor_id, actor_email, action, target_type, target_id, metadata, ip_address, user_agent)
      VALUES
        (${entry.actorId}, ${entry.actorEmail}, ${entry.action}, ${entry.targetType},
         ${entry.targetId}, ${JSON.stringify(entry.metadata)}::jsonb,
         ${entry.ipAddress}, ${entry.userAgent})
    `);
  } catch (err) {
    // Audit log failure must never break the request — log and continue
    logger.error({ err, action, actorId: user.id }, "[audit] Failed to write audit log entry");
  }
}
