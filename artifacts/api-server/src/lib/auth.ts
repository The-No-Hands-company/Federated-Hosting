import * as client from "openid-client";
import crypto from "crypto";
import { type Request, type Response } from "express";
import { db, sessionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { AuthUser } from "@workspace/api-zod";
import { getRedisClient } from "./redis";

// ISSUER_URL must be set to your OIDC provider's issuer URL.
// Examples:
//   Authentik:  https://auth.yourdomain.com/application/o/nexushosting/
//   Keycloak:   https://auth.yourdomain.com/realms/nexushosting
//   Auth0:      https://your-tenant.us.auth0.com/
//   Dex:        https://dex.yourdomain.com
if (!process.env.ISSUER_URL) {
  throw new Error("ISSUER_URL must be set to your OIDC provider's issuer URL.");
}
if (!process.env.OIDC_CLIENT_ID) {
  throw new Error("OIDC_CLIENT_ID must be set to your OIDC client ID.");
}

export const ISSUER_URL = process.env.ISSUER_URL;
export const SESSION_COOKIE = "sid";
export const SESSION_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
const SESSION_TTL_SECONDS = Math.floor(SESSION_TTL / 1000);

export interface SessionData {
  user: AuthUser;
  access_token: string;
  refresh_token?: string;
  expires_at?: number;

  /**
   * Set while a login is waiting on a second factor. A session carrying this
   * has authenticated a password but must not be treated as fully signed in.
   * routes/auth.ts writes it and routes/twoFactor.ts clears it on success;
   * neither typechecked before, because SessionData did not admit the field.
   */
  twoFactorPending?: boolean;

  /** The session id being upgraded, held across the 2FA challenge. */
  pendingSid?: string;
}

/**
 * Set the session cookie.
 *
 * Lives here rather than in a route because two routes need it and its flags
 * are security-relevant: httpOnly keeps the session out of scripts, secure
 * keeps it off plaintext, sameSite=lax blunts CSRF. routes/twoFactor.ts
 * imported this from lib/auth and it was not here — it was a private function
 * in routes/auth.ts — so the 2FA session upgrade could not have run. Defining
 * it once means the two paths cannot drift into different flags.
 */
export function setSessionCookie(res: import("express").Response, sid: string): void {
  res.cookie(SESSION_COOKIE, sid, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL,
  });
}

let oidcConfig: client.Configuration | null = null;

export async function getOidcConfig(): Promise<client.Configuration> {
  if (!oidcConfig) {
    // The third argument is the client secret. Passed only when one is
    // configured, so a self-hosted node can still register this as a public
    // client and rely on PKCE alone — but where a secret exists, a server-side
    // app should use it rather than authenticate with PKCE only.
    const clientSecret = process.env.OIDC_CLIENT_SECRET;  // pragma: allowlist secret
    oidcConfig = clientSecret
      ? await client.discovery(new URL(ISSUER_URL), process.env.OIDC_CLIENT_ID!, clientSecret)
      : await client.discovery(new URL(ISSUER_URL), process.env.OIDC_CLIENT_ID!);
  }
  return oidcConfig;
}

// ── Session store — Redis-first, PostgreSQL fallback ─────────────────────────
// When Redis is available, sessions are stored there (fast, shared across instances).
// PostgreSQL is used as the durable fallback when Redis is not configured.
// The PostgreSQL record is still written as a durability backstop.

function sessionKey(sid: string): string {
  return `session:${sid}`;
}

export async function createSession(data: SessionData): Promise<string> {
  const sid = crypto.randomBytes(32).toString("hex");
  const expire = new Date(Date.now() + SESSION_TTL);
  const serialised = JSON.stringify(data);

  // Write to Redis if available (primary session store when multi-instance)
  const redis = getRedisClient();
  if (redis) {
    try {
      await redis.set(sessionKey(sid), serialised, "EX", SESSION_TTL_SECONDS);
    } catch {
      // Redis write failure — fall through to PostgreSQL
    }
  }

  // Always write to PostgreSQL (durable backup + audit trail)
  await db.insert(sessionsTable).values({
    sid,
    sess: data as unknown as Record<string, unknown>,
    expire,
  });

  return sid;
}

export async function getSession(sid: string): Promise<SessionData | null> {
  // Try Redis first (fast path)
  const redis = getRedisClient();
  if (redis) {
    try {
      const raw = await redis.get(sessionKey(sid));
      if (raw) return JSON.parse(raw) as SessionData;
      // Not in Redis — check PostgreSQL (e.g. after Redis restart)
    } catch {
      // Redis unavailable — fall through to PostgreSQL
    }
  }

  // PostgreSQL fallback
  const [row] = await db
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.sid, sid));

  if (!row) return null;

  if (row.expire && row.expire < new Date()) {
    await db.delete(sessionsTable).where(eq(sessionsTable.sid, sid));
    return null;
  }

  // Session found in PostgreSQL — re-populate Redis so next read is fast
  if (redis && row.sess) {
    try {
      const ttlSeconds = Math.floor((row.expire!.getTime() - Date.now()) / 1000);
      if (ttlSeconds > 0) {
        await redis.set(sessionKey(sid), JSON.stringify(row.sess), "EX", ttlSeconds);
      }
    } catch { /* non-fatal */ }
  }

  return row.sess as unknown as SessionData;
}

export async function destroySession(sid: string): Promise<void> {
  // Remove from both stores
  const redis = getRedisClient();
  if (redis) {
    try { await redis.del(sessionKey(sid)); } catch { /* non-fatal */ }
  }
  await db.delete(sessionsTable).where(eq(sessionsTable.sid, sid));
}

export function getSessionId(req: Request): string | null {
  return req.cookies?.[SESSION_COOKIE] ?? null;
}

export async function updateSession(sid: string, data: SessionData): Promise<void> {
  const expire = new Date(Date.now() + SESSION_TTL);
  const serialised = JSON.stringify(data);

  const redis = getRedisClient();
  if (redis) {
    try {
      await redis.set(sessionKey(sid), serialised, "EX", SESSION_TTL_SECONDS);
    } catch { /* non-fatal */ }
  }

  await db
    .update(sessionsTable)
    .set({ sess: data as unknown as Record<string, unknown>, expire })
    .where(eq(sessionsTable.sid, sid));
}

/**
 * Destroy a session and clear its cookie.
 *
 * `sid` is nullable because every caller gets it from getSessionId, which
 * returns string | null — a request with no session cookie has no id. Clearing
 * must still remove the cookie in that case: a browser holding an unparseable
 * or already-destroyed session cookie should end up without one, not keep it
 * because the server could not find a matching record.
 */
export async function clearSession(res: Response, sid: string | null): Promise<void> {
  if (sid) await destroySession(sid);
  res.clearCookie(SESSION_COOKIE);
}

/** Alias for destroySession — deletes the session from storage without touching the response. */
export const deleteSession = destroySession;

export function getUserFromRequest(req: Request): AuthUser | null {
  return (req as any).user ?? null;
}

