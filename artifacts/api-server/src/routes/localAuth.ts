/**
 * Local auth routes — email + password authentication.
 *
 * All routes are guarded by LOCAL_AUTH_ENABLED (default: true).
 * Node operators can disable by setting LOCAL_AUTH_ENABLED=false in .env.
 *
 * Routes:
 *   POST /api/auth/local/register   — create account
 *   POST /api/auth/local/login      — get session
 *   POST /api/auth/local/logout     — clear session
 *   POST /api/auth/local/forgot     — send password reset email
 *   POST /api/auth/local/reset      — consume reset token, set new password
 *   GET  /api/auth/local/available  — check if local auth is enabled
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod/v4";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { db, usersTable, localAuthTable, passwordResetTokensTable } from "@workspace/db";
import { eq, and, gt, isNull } from "drizzle-orm";
import { asyncHandler } from "../lib/asyncHandler.js";
import { AppError } from "../lib/errors.js";
import { rateLimiter, authLimiter } from "../middleware/rateLimiter.js";
import { sendMail } from "../lib/email.js";
import logger from "../lib/logger.js";

const router = Router();

const ENABLED        = process.env.LOCAL_AUTH_ENABLED !== "false";
const BCRYPT_ROUNDS  = 12;
const RESET_TTL_MS   = 60 * 60 * 1000; // 1 hour
const PUBLIC_DOMAIN  = process.env.PUBLIC_DOMAIN ?? "localhost:8080";

function guard(req: Request, res: Response, next: () => void) {
  if (!ENABLED) {
    res.status(404).json({ error: "Local auth is disabled on this node.", code: "LOCAL_AUTH_DISABLED" });
    return;
  }
  next();
}

function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

// ── GET /api/auth/local/available ─────────────────────────────────────────────

router.get("/auth/local/available", (_req, res) => {
  res.json({ enabled: ENABLED });
});

// ── POST /api/auth/local/register ─────────────────────────────────────────────

const RegisterBody = z.object({
  email:    z.email().max(254).transform(e => e.toLowerCase().trim()),
  password: z.string().min(8).max(128),
  name:     z.string().min(1).max(80).optional(),
});

router.post("/auth/local/register", guard, authLimiter, asyncHandler(async (req: Request, res: Response) => {
  const parsed = RegisterBody.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest(parsed.error.message);

  const { email, password, name } = parsed.data;

  // Check email not already registered
  const [existing] = await db
    .select({ id: localAuthTable.id })
    .from(localAuthTable)
    .where(eq(localAuthTable.email, email))
    .limit(1);

  if (existing) {
    throw AppError.conflict("An account with this email already exists.", "EMAIL_TAKEN");
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  // Parse name into first/last
  const nameParts = (name ?? "").trim().split(/\s+/);
  const firstName = nameParts[0] || null;
  const lastName  = nameParts.slice(1).join(" ") || null;

  // Create user
  const [user] = await db.insert(usersTable).values({
    email,
    firstName,
    lastName,
    emailVerified: 0,
  }).returning();

  // Create local auth record
  await db.insert(localAuthTable).values({
    userId:       user.id,
    email,
    passwordHash,
  });

  // Send verification email
  if (process.env.SMTP_HOST) {
    const { sendVerificationEmail } = await import("../lib/emailVerification.js");
    sendVerificationEmail(user.id, email, PUBLIC_DOMAIN).catch(() => {});
  }

  // Log the user in immediately
  await new Promise<void>((resolve, reject) => {
    (req as any).login({ id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, profileImageUrl: null }, (err: any) => {
      if (err) reject(err); else resolve();
    });
  });

  logger.info({ userId: user.id }, "[local-auth] New registration");

  res.status(201).json({
    ok: true,
    user: { id: user.id, email: user.email, firstName, lastName },
    message: "Account created. Check your email to verify your address.",
  });
}));

// ── POST /api/auth/local/login ────────────────────────────────────────────────

const LoginBody = z.object({
  email:    z.string().transform(e => e.toLowerCase().trim()),
  password: z.string(),
});

router.post("/auth/local/login", guard, authLimiter, asyncHandler(async (req: Request, res: Response) => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest(parsed.error.message);

  const { email, password } = parsed.data;

  // Fetch local auth record
  const [record] = await db
    .select({
      userId:       localAuthTable.userId,
      passwordHash: localAuthTable.passwordHash,
    })
    .from(localAuthTable)
    .where(eq(localAuthTable.email, email))
    .limit(1);

  // Timing-safe: always run bcrypt even on miss (prevents user enumeration)
  const dummyHash = "$2b$12$invalidhashfortimingprotection000000000000000000000000";
  const match = record
    ? await bcrypt.compare(password, record.passwordHash)
    : await bcrypt.compare(password, dummyHash).then(() => false);

  if (!match) {
    throw AppError.unauthorized("Incorrect email or password.", "INVALID_CREDENTIALS");
  }

  // Fetch full user
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, record.userId))
    .limit(1);

  if (!user) throw AppError.unauthorized("Account not found.", "INVALID_CREDENTIALS");

  // Check suspension
  if (user.suspendedAt) {
    throw AppError.forbidden("Your account has been suspended. Contact the node operator.", "ACCOUNT_SUSPENDED");
  }

  // Log in
  await new Promise<void>((resolve, reject) => {
    (req as any).login({
      id: user.id, email: user.email,
      firstName: user.firstName, lastName: user.lastName,
      profileImageUrl: user.profileImageUrl,
    }, (err: any) => {
      if (err) reject(err); else resolve();
    });
  });

  logger.info({ userId: user.id }, "[local-auth] Login");

  res.json({
    ok: true,
    user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName },
  });
}));

// ── POST /api/auth/local/logout ───────────────────────────────────────────────

router.post("/auth/local/logout", guard, (req: Request, res: Response) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({ ok: true });
  });
});

// ── POST /api/auth/local/forgot ───────────────────────────────────────────────

const ForgotBody = z.object({
  email: z.email().transform(e => e.toLowerCase().trim()),
});

router.post("/auth/local/forgot", guard, rateLimiter, asyncHandler(async (req: Request, res: Response) => {
  const parsed = ForgotBody.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest(parsed.error.message);

  const { email } = parsed.data;

  // Always respond success to prevent email enumeration
  res.json({ ok: true, message: "If that email is registered, you'll receive a reset link." });

  // Find account (after responding)
  const [record] = await db
    .select({ userId: localAuthTable.userId })
    .from(localAuthTable)
    .where(eq(localAuthTable.email, email))
    .limit(1);

  if (!record) return;

  const raw       = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(raw);
  const expiresAt = new Date(Date.now() + RESET_TTL_MS);

  // Invalidate existing tokens
  await db.delete(passwordResetTokensTable)
    .where(eq(passwordResetTokensTable.userId, record.userId));

  await db.insert(passwordResetTokensTable).values({
    userId: record.userId, tokenHash, expiresAt,
  });

  const resetUrl = `https://${PUBLIC_DOMAIN}/reset-password?token=${raw}`;

  await sendMail({
    to: email,
    subject: "Reset your Nexus Hosting password",
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;background:#12121a;color:#e4e4f0;padding:2rem;border-radius:16px;border:1px solid rgba(255,255,255,0.08)">
        <h1 style="color:#fff;font-size:1.5rem;margin-bottom:1rem">Reset your password</h1>
        <p style="color:#9ca3af;margin-bottom:1.5rem">Click the link below to set a new password. The link expires in 1 hour.</p>
        <a href="${resetUrl}" style="display:inline-block;background:#00e5ff;color:#000;font-weight:700;padding:0.75rem 1.5rem;border-radius:10px;text-decoration:none">
          Reset password
        </a>
        <p style="color:#6b7280;font-size:0.8rem;margin-top:1.5rem">If you didn't request this, ignore this email.</p>
      </div>
    `,
    text: `Reset your Nexus Hosting password: ${resetUrl}\n\nExpires in 1 hour.`,
  });
}));

// ── POST /api/auth/local/reset ────────────────────────────────────────────────

const ResetBody = z.object({
  token:    z.string().min(32),
  password: z.string().min(8).max(128),
});

router.post("/auth/local/reset", guard, authLimiter, asyncHandler(async (req: Request, res: Response) => {
  const parsed = ResetBody.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest(parsed.error.message);

  const { token, password } = parsed.data;
  const tokenHash = hashToken(token);
  const now = new Date();

  const [record] = await db
    .select()
    .from(passwordResetTokensTable)
    .where(and(
      eq(passwordResetTokensTable.tokenHash, tokenHash),
      gt(passwordResetTokensTable.expiresAt, now),
      isNull(passwordResetTokensTable.usedAt),
    ))
    .limit(1);

  if (!record) {
    throw AppError.badRequest("Invalid or expired reset token.", "INVALID_RESET_TOKEN");
  }

  const newHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  // Update password and mark token used in a transaction
  await db.transaction(async (tx) => {
    await tx.update(localAuthTable)
      .set({ passwordHash: newHash, updatedAt: new Date() })
      .where(eq(localAuthTable.userId, record.userId));

    await tx.update(passwordResetTokensTable)
      .set({ usedAt: new Date() })
      .where(eq(passwordResetTokensTable.id, record.id));
  });

  logger.info({ userId: record.userId }, "[local-auth] Password reset");

  res.json({ ok: true, message: "Password updated. You can now log in with your new password." });
}));

export default router;
