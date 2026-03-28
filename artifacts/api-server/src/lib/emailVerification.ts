/**
 * Email verification service.
 *
 * Flow:
 *  1. After OIDC callback, if user.emailVerified=0, call sendVerificationEmail()
 *  2. User clicks the link → GET /api/auth/verify-email?token=xxx
 *  3. Token matched, user.emailVerified set to 1
 *
 * Tokens are 32 random bytes (64 hex chars), stored hashed,
 * valid for 24 hours, single-use.
 */

import crypto from "crypto";
import { db } from "@workspace/db";
import { emailVerificationTokensTable, usersTable } from "@workspace/db";
import { eq, and, gt } from "drizzle-orm";
import { sendMail } from "./email.js";

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

/** Issue a verification token and send the email. */
export async function sendVerificationEmail(userId: string, email: string, publicDomain: string): Promise<void> {
  const raw = crypto.randomBytes(32).toString("hex");
  const hashed = hashToken(raw);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  // Invalidate any existing unused tokens for this user
  await db.delete(emailVerificationTokensTable)
    .where(and(
      eq(emailVerificationTokensTable.userId, userId),
      eq(emailVerificationTokensTable.email, email),
    ));

  await db.insert(emailVerificationTokensTable).values({
    userId,
    email,
    token:     hashed,
    expiresAt,
  });

  const verifyUrl = `https://${publicDomain}/api/auth/verify-email?token=${raw}`;

  await sendMail({
    to: email,
    subject: "Verify your NexusHosting email address",
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;background:#12121a;color:#e4e4f0;padding:2rem;border-radius:16px;border:1px solid rgba(255,255,255,0.08)">
        <h1 style="color:#fff;font-size:1.5rem;margin-bottom:1rem">Verify your email</h1>
        <p style="color:#9ca3af;margin-bottom:1.5rem">
          Click the button below to verify your email address and unlock all NexusHosting features.
          This link expires in 24 hours.
        </p>
        <a href="${verifyUrl}"
           style="display:inline-block;background:#00e5ff;color:#000;font-weight:700;
                  padding:0.75rem 1.5rem;border-radius:10px;text-decoration:none;font-size:0.9375rem">
          Verify email address
        </a>
        <p style="color:#6b7280;font-size:0.8125rem;margin-top:1.5rem">
          If you did not create a NexusHosting account, you can safely ignore this email.
        </p>
        <p style="color:#6b7280;font-size:0.75rem;margin-top:0.5rem;word-break:break-all">
          ${verifyUrl}
        </p>
      </div>
    `,
    text: `Verify your NexusHosting email: ${verifyUrl}\n\nThis link expires in 24 hours.`,
  });
}

/** Consume a verification token. Returns userId on success, null on failure. */
export async function verifyEmailToken(rawToken: string): Promise<string | null> {
  const hashed = hashToken(rawToken);
  const now = new Date();

  const [record] = await db
    .select()
    .from(emailVerificationTokensTable)
    .where(and(
      eq(emailVerificationTokensTable.token, hashed),
      gt(emailVerificationTokensTable.expiresAt, now),
    ))
    .limit(1);

  if (!record || record.usedAt) return null;

  // Mark token used
  await db.update(emailVerificationTokensTable)
    .set({ usedAt: now })
    .where(eq(emailVerificationTokensTable.id, record.id));

  // Mark user verified
  await db.update(usersTable)
    .set({ emailVerified: 1 })
    .where(eq(usersTable.id, record.userId));

  return record.userId;
}
