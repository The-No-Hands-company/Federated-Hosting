/**
 * Two-factor authentication (TOTP).
 *
 * Uses RFC 6238 TOTP (Time-based One-Time Password) compatible with
 * Google Authenticator, Authy, 1Password, Bitwarden, etc.
 *
 * Flow:
 *   1. POST /api/auth/2fa/setup    — generate secret + QR code
 *   2. User scans QR code with authenticator app
 *   3. POST /api/auth/2fa/verify   — confirm a TOTP code to enable 2FA
 *   4. 2FA is now active; future logins require a TOTP code
 *
 * Routes:
 *   POST /api/auth/2fa/setup    — generate secret + QR code URL (authenticated)
 *   POST /api/auth/2fa/verify   — verify code and enable 2FA
 *   POST /api/auth/2fa/disable  — disable 2FA (requires TOTP or backup code)
 *   POST /api/auth/2fa/validate — validate a TOTP code (for login flow)
 *   GET  /api/auth/2fa/status   — check if 2FA is enabled for current user
 *   POST /api/auth/2fa/backup   — regenerate backup codes
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod/v4";
import crypto from "crypto";
import { authenticator } from "otplib";
import QRCode from "qrcode";
import { db, totpCredentialsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { asyncHandler, AppError } from "../lib/errors";
import { writeLimiter, authLimiter } from "../middleware/rateLimiter";
import logger from "../lib/logger";

const router: IRouter = Router();

// TOTP configuration — 30-second window, allow 1 step past/future for clock skew
authenticator.options = { step: 30, window: 1 };

const APP_NAME = process.env.APP_NAME ?? "NexusHosting";
const BACKUP_CODE_COUNT = 10;

function generateBackupCodes(): string[] {
  return Array.from({ length: BACKUP_CODE_COUNT }, () =>
    crypto.randomBytes(4).toString("hex").toUpperCase().match(/.{4}/g)!.join("-")
  );
}

function hashBackupCode(code: string): string {
  return crypto.createHash("sha256").update(code.replace(/-/g, "").toUpperCase()).digest("hex");
}

// Per-user TOTP attempt tracking — lockout after 5 failures in 10 minutes
const MAX_TOTP_FAILURES = 5;
const TOTP_LOCKOUT_WINDOW_S = 10 * 60;
const TOTP_LOCKOUT_KEY = (userId: string) => `totp_failures:${userId}`;

async function checkAndRecordTotpFailure(userId: string): Promise<{ locked: boolean; remaining: number }> {
  const redis = (await import("../lib/redis")).getRedisClient();
  if (!redis) return { locked: false, remaining: MAX_TOTP_FAILURES };

  const key = TOTP_LOCKOUT_KEY(userId);
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, TOTP_LOCKOUT_WINDOW_S);

  const locked   = count >= MAX_TOTP_FAILURES;
  const remaining = Math.max(0, MAX_TOTP_FAILURES - count);
  return { locked, remaining };
}

async function clearTotpFailures(userId: string): Promise<void> {
  const redis = (await import("../lib/redis")).getRedisClient();
  if (redis) await redis.del(TOTP_LOCKOUT_KEY(userId)).catch(() => {});
}

async function isTotpLocked(userId: string): Promise<boolean> {
  const redis = (await import("../lib/redis")).getRedisClient();
  if (!redis) return false;
  const count = parseInt(await redis.get(TOTP_LOCKOUT_KEY(userId)) ?? "0", 10);
  return count >= MAX_TOTP_FAILURES;
}

router.get("/auth/2fa/status", asyncHandler(async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();

  const [totp] = await db
    .select({ enabledAt: totpCredentialsTable.enabledAt })
    .from(totpCredentialsTable)
    .where(eq(totpCredentialsTable.userId, req.user.id));

  res.json({ enabled: !!totp, enabledAt: totp?.enabledAt ?? null });
}));

// ── Setup — generate secret and QR code ──────────────────────────────────────

router.post("/auth/2fa/setup", asyncHandler(async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();

  const [existing] = await db
    .select({ id: totpCredentialsTable.id })
    .from(totpCredentialsTable)
    .where(eq(totpCredentialsTable.userId, req.user.id));

  if (existing) throw AppError.conflict("2FA is already enabled. Disable it first.");

  const secret = authenticator.generateSecret(32);
  const email  = req.user.email ?? req.user.id;
  const otpAuthUrl = authenticator.keyuri(email, APP_NAME, secret);

  // Generate QR code as base64 data URL
  const qrCode = await QRCode.toDataURL(otpAuthUrl, { width: 256, margin: 2 });

  res.json({
    secret,
    otpAuthUrl,
    qrCode,
    manualEntry: { account: email, issuer: APP_NAME, secret },
    message: "Scan the QR code with your authenticator app, then call POST /auth/2fa/verify with a valid code.",
  });
}));

// ── Verify — confirm a TOTP code and enable 2FA ───────────────────────────────

router.post("/auth/2fa/verify", writeLimiter, asyncHandler(async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();

  const { code, secret } = z.object({
    code:   z.string().min(6).max(6),
    secret: z.string().min(16), // sent back from /setup
  }).parse(req.body);

  const isValid = authenticator.check(code, secret);
  if (!isValid) throw AppError.badRequest("Invalid or expired code. Check your authenticator app clock.", "INVALID_TOTP");

  const [existing] = await db.select({ id: totpCredentialsTable.id }).from(totpCredentialsTable).where(eq(totpCredentialsTable.userId, req.user.id));
  if (existing) throw AppError.conflict("2FA already enabled");

  const backupCodes    = generateBackupCodes();
  const hashedBackups  = backupCodes.map(hashBackupCode);

  await db.insert(totpCredentialsTable).values({
    userId:      req.user.id,
    secret,
    backupCodes: hashedBackups,
  });

  logger.info({ userId: req.user.id }, "[2fa] Enabled");

  res.json({
    enabled: true,
    backupCodes, // shown ONCE — user must save these
    message: "2FA enabled. Save your backup codes in a secure location. They will not be shown again.",
  });
}));

// ── Validate — check a TOTP code (used during login) ─────────────────────────

router.post("/auth/2fa/validate", authLimiter, asyncHandler(async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();

  if (await isTotpLocked(req.user.id)) {
    throw AppError.badRequest("Account temporarily locked due to too many failed attempts. Try again in 10 minutes.", "TOTP_LOCKED");
  }

  const { code } = z.object({ code: z.string().min(6).max(10) }).parse(req.body);

  const [cred] = await db.select().from(totpCredentialsTable).where(eq(totpCredentialsTable.userId, req.user.id));
  if (!cred) throw AppError.badRequest("2FA is not enabled for this account");

  // Try TOTP first
  const isValid = authenticator.check(code.replace(/-/g, ""), cred.secret);

  if (isValid) {
    await clearTotpFailures(req.user.id);
    res.json({ valid: true, method: "totp" });
    return;
  }

  // Try backup code — atomically remove it using a DB transaction to prevent races
  const normalized = code.replace(/-/g, "").toUpperCase();
  const codeHash   = crypto.createHash("sha256").update(normalized).digest("hex");

  const consumed = await db.transaction(async (tx) => {
    // Re-fetch inside transaction with row lock
    const [locked] = await tx
      .select({ backupCodes: totpCredentialsTable.backupCodes })
      .from(totpCredentialsTable)
      .where(eq(totpCredentialsTable.userId, req.user.id))
      .for("update");

    if (!locked) return false;
    const backups = locked.backupCodes as string[];
    const idx = backups.indexOf(codeHash);
    if (idx === -1) return false;

    const remaining = [...backups];
    remaining.splice(idx, 1);
    await tx.update(totpCredentialsTable)
      .set({ backupCodes: remaining })
      .where(eq(totpCredentialsTable.userId, req.user.id));
    return remaining.length;
  });

  if (consumed !== false) {
    logger.warn({ userId: req.user.id, remaining: consumed }, "[2fa] Backup code used");
    res.json({ valid: true, method: "backup", remainingBackupCodes: consumed });
    return;
  }

  const { locked, remaining } = await checkAndRecordTotpFailure(req.user.id);
  if (locked) {
    throw AppError.badRequest("Too many failed attempts. Account locked for 10 minutes.", "TOTP_LOCKED");
  }
  throw AppError.badRequest(`Invalid code. ${remaining} attempt${remaining !== 1 ? "s" : ""} remaining.`, "INVALID_TOTP");
}));

// ── Disable 2FA ───────────────────────────────────────────────────────────────

router.post("/auth/2fa/disable", writeLimiter, asyncHandler(async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();

  const { code } = z.object({ code: z.string().min(6).max(10) }).parse(req.body);

  const [cred] = await db.select().from(totpCredentialsTable).where(eq(totpCredentialsTable.userId, req.user.id));
  if (!cred) throw AppError.badRequest("2FA is not enabled");

  const isValid = authenticator.check(code.replace(/-/g, ""), cred.secret);
  const isBackup = !isValid && (cred.backupCodes as string[]).includes(
    crypto.createHash("sha256").update(code.replace(/-/g, "").toUpperCase()).digest("hex")
  );

  if (!isValid && !isBackup) {
    throw AppError.badRequest("Invalid code", "INVALID_TOTP");
  }

  await db.delete(totpCredentialsTable).where(eq(totpCredentialsTable.userId, req.user.id));
  logger.info({ userId: req.user.id }, "[2fa] Disabled");
  res.json({ disabled: true });
}));

// ── Regenerate backup codes ───────────────────────────────────────────────────

router.post("/auth/2fa/backup", writeLimiter, asyncHandler(async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();

  const { code } = z.object({ code: z.string().min(6).max(6) }).parse(req.body);

  const [cred] = await db.select().from(totpCredentialsTable).where(eq(totpCredentialsTable.userId, req.user.id));
  if (!cred) throw AppError.badRequest("2FA is not enabled");
  if (!authenticator.check(code, cred.secret)) throw AppError.badRequest("Invalid code", "INVALID_TOTP");

  const newCodes  = generateBackupCodes();
  const hashed    = newCodes.map(hashBackupCode);

  await db.update(totpCredentialsTable)
    .set({ backupCodes: hashed })
    .where(eq(totpCredentialsTable.userId, req.user.id));

  res.json({ backupCodes: newCodes, message: "Old backup codes have been invalidated. Save these new ones." });
}));

// ── Complete login challenge ───────────────────────────────────────────────────
// Called from the 2FA challenge page after the user enters their TOTP code.
// Upgrades the pending session to a full authenticated session.

router.post("/auth/2fa/complete", authLimiter, asyncHandler(async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();

  // Must have a pending 2FA session
  const session = (req as any).sessionData as { twoFactorPending?: boolean } | undefined;
  if (!session?.twoFactorPending) {
    throw AppError.badRequest("No pending 2FA challenge", "NO_2FA_PENDING");
  }

  const { code } = z.object({ code: z.string().min(6).max(10) }).parse(req.body);

  const [cred] = await db.select().from(totpCredentialsTable).where(eq(totpCredentialsTable.userId, req.user.id));
  if (!cred) throw AppError.badRequest("2FA credential not found");

  // Try TOTP
  const isValid = authenticator.check(code.replace(/-/g, ""), cred.secret);

  // Try backup code
  let usedBackup = false;
  if (!isValid) {
    const normalized = code.replace(/-/g, "").toUpperCase();
    const codeHash   = crypto.createHash("sha256").update(normalized).digest("hex");
    const backups    = cred.backupCodes as string[];
    const idx        = backups.indexOf(codeHash);
    if (idx !== -1) {
      usedBackup = true;
      const remaining = [...backups];
      remaining.splice(idx, 1);
      await db.update(totpCredentialsTable)
        .set({ backupCodes: remaining })
        .where(eq(totpCredentialsTable.userId, req.user.id));
    }
  }

  if (!isValid && !usedBackup) {
    throw AppError.badRequest("Invalid code", "INVALID_TOTP");
  }

  // Upgrade session: remove the twoFactorPending flag
  const { twoFactorPending: _, pendingSid: __, ...cleanSession } = session as any;
  const { createSession, SESSION_COOKIE, setSessionCookie, clearSession, getSessionId } =
    await import("../lib/auth");
  const oldSid = getSessionId(req as any);
  await clearSession(res as any, oldSid);
  const newSid = await createSession(cleanSession);
  setSessionCookie(res as any, newSid);

  logger.info({ userId: req.user.id, method: usedBackup ? "backup" : "totp" }, "[2fa] Challenge completed");
  res.json({ authenticated: true, method: usedBackup ? "backup" : "totp" });
}));

export default router;
