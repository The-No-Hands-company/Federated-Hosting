import { Router, type IRouter, type Request, type Response } from "express";
import { db, sitesTable, siteMembersTable, usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { asyncHandler, AppError } from "../lib/errors";
import { writeLimiter, authLimiter } from "../middleware/rateLimiter";

// Per-site-per-IP unlock limiter: max 5 attempts per 15 minutes
// Prevents automated password guessing on password-protected sites
import rateLimit from "express-rate-limit";
const unlockLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: process.env.NODE_ENV === "production" ? 5 : 1000,
  keyGenerator: (req) => `${req.ip}:${req.params.id}`,
  handler: (_req, res) =>
    res.status(429).json({ error: "Too many unlock attempts. Try again in 15 minutes.", code: "UNLOCK_RATE_LIMITED" }),
  standardHeaders: "draft-7",
  legacyHeaders: false,
});
import { z } from "zod/v4";
import crypto from "crypto";
import { invalidateSiteCache } from "../lib/domainCache";

const router: IRouter = Router();

const AddMemberBody = z.object({
  userId: z.string().min(1),
  role: z.enum(["editor", "viewer"]).default("viewer"),
});

const UpdateVisibilityBody = z.object({
  visibility: z.enum(["public", "private", "password"]),
  password: z.string().min(6).max(128).optional(),
});

async function requireSiteOwner(req: Request, siteId: number) {
  if (!req.isAuthenticated()) throw AppError.unauthorized();
  const [site] = await db.select().from(sitesTable).where(eq(sitesTable.id, siteId));
  if (!site) throw AppError.notFound("Site not found");
  if (site.ownerId !== req.user.id) throw AppError.forbidden("Only the site owner can manage access");
  return site;
}

// ── Team members ──────────────────────────────────────────────────────────────

router.get("/sites/:id/members", asyncHandler(async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();
  const siteId = parseInt(req.params.id as string, 10);
  if (Number.isNaN(siteId)) throw AppError.badRequest("Invalid site ID");

  const [site] = await db.select({ ownerId: sitesTable.ownerId }).from(sitesTable).where(eq(sitesTable.id, siteId));
  if (!site) throw AppError.notFound("Site not found");
  if (site.ownerId !== req.user.id) throw AppError.forbidden();

  const members = await db
    .select({
      id: siteMembersTable.id,
      userId: siteMembersTable.userId,
      role: siteMembersTable.role,
      acceptedAt: siteMembersTable.acceptedAt,
      createdAt: siteMembersTable.createdAt,
      email: usersTable.email,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      profileImageUrl: usersTable.profileImageUrl,
    })
    .from(siteMembersTable)
    .leftJoin(usersTable, eq(siteMembersTable.userId, usersTable.id))
    .where(eq(siteMembersTable.siteId, siteId));

  res.json(members);
}));

router.post("/sites/:id/members", writeLimiter, asyncHandler(async (req: Request, res: Response) => {
  const siteId = parseInt(req.params.id as string, 10);
  if (Number.isNaN(siteId)) throw AppError.badRequest("Invalid site ID");
  await requireSiteOwner(req, siteId);

  const parsed = AddMemberBody.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest(parsed.error.message);

  const [targetUser] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, parsed.data.userId));
  if (!targetUser) throw AppError.notFound("User not found");

  const [existing] = await db
    .select()
    .from(siteMembersTable)
    .where(and(eq(siteMembersTable.siteId, siteId), eq(siteMembersTable.userId, parsed.data.userId)));

  if (existing) throw AppError.conflict("User is already a member of this site");

  const [member] = await db
    .insert(siteMembersTable)
    .values({
      siteId,
      userId: parsed.data.userId,
      role: parsed.data.role,
      invitedByUserId: req.user.id,
      acceptedAt: new Date(),
    })
    .returning();

  res.status(201).json(member);
}));

router.patch("/sites/:id/members/:memberId", writeLimiter, asyncHandler(async (req: Request, res: Response) => {
  const siteId = parseInt(req.params.id as string, 10);
  const memberId = parseInt(req.params.memberId as string, 10);
  if (Number.isNaN(siteId) || Number.isNaN(memberId)) throw AppError.badRequest("Invalid ID");
  await requireSiteOwner(req, siteId);

  const { role } = z.object({ role: z.enum(["editor", "viewer"]) }).parse(req.body);

  const [updated] = await db
    .update(siteMembersTable)
    .set({ role })
    .where(and(eq(siteMembersTable.id, memberId), eq(siteMembersTable.siteId, siteId)))
    .returning();

  if (!updated) throw AppError.notFound("Member not found");
  res.json(updated);
}));

router.delete("/sites/:id/members/:memberId", writeLimiter, asyncHandler(async (req: Request, res: Response) => {
  const siteId = parseInt(req.params.id as string, 10);
  const memberId = parseInt(req.params.memberId as string, 10);
  if (Number.isNaN(siteId) || Number.isNaN(memberId)) throw AppError.badRequest("Invalid ID");
  await requireSiteOwner(req, siteId);

  const [deleted] = await db
    .delete(siteMembersTable)
    .where(and(eq(siteMembersTable.id, memberId), eq(siteMembersTable.siteId, siteId)))
    .returning();

  if (!deleted) throw AppError.notFound("Member not found");
  res.sendStatus(204);
}));

// ── Site visibility + password ────────────────────────────────────────────────

router.patch("/sites/:id/visibility", writeLimiter, asyncHandler(async (req: Request, res: Response) => {
  const siteId = parseInt(req.params.id as string, 10);
  if (Number.isNaN(siteId)) throw AppError.badRequest("Invalid site ID");
  await requireSiteOwner(req, siteId);

  const parsed = UpdateVisibilityBody.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest(parsed.error.message);

  const { visibility, password } = parsed.data;

  if (visibility === "password" && !password) {
    throw AppError.badRequest("A password is required when visibility is 'password'");
  }

  let passwordHash: string | null = null;
  if (visibility === "password" && password) {
    // Use scrypt — built into Node.js, no extra deps
    const salt = crypto.randomBytes(16).toString("hex");
    const derived = crypto.scryptSync(password, salt, 64).toString("hex");
    passwordHash = `${salt}:${derived}`;
  }

  const [updated] = await db
    .update(sitesTable)
    .set({ visibility, passwordHash })
    .where(eq(sitesTable.id, siteId))
    .returning({ id: sitesTable.id, visibility: sitesTable.visibility });

  // Invalidate domain cache so the new visibility is reflected immediately
  invalidateSiteCache(siteId);

  res.json(updated);
}));

/** POST /api/sites/:id/unlock — verify password, issue HMAC-signed unlock cookie */
router.post("/sites/:id/unlock", unlockLimiter, asyncHandler(async (req: Request, res: Response) => {
  const siteId = parseInt(req.params.id as string, 10);
  if (Number.isNaN(siteId)) throw AppError.badRequest("Invalid site ID");

  const { password } = z.object({ password: z.string() }).parse(req.body);

  const [site] = await db.select({ id: sitesTable.id, domain: sitesTable.domain, passwordHash: sitesTable.passwordHash, visibility: sitesTable.visibility })
    .from(sitesTable).where(eq(sitesTable.id, siteId));

  if (!site || site.visibility !== "password") throw AppError.notFound("Site not found");

  if (!site.passwordHash) throw AppError.internal("Site password not configured");

  const [salt, stored] = site.passwordHash.split(":");
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");

  if (derived !== stored) throw AppError.forbidden("Incorrect password");

  // Issue HMAC-signed unlock token so the server can verify it without a DB lookup.
  // Format: base64url(siteId:issuedAt:hmac)
  const secret = process.env.COOKIE_SECRET ?? (process.env.NODE_ENV === "production" ? (() => { throw new Error("COOKIE_SECRET must be set in production"); })() : "dev-only-insecure-cookie-secret");
  const issuedAt = Math.floor(Date.now() / 1000).toString();
  const payload = `${site.id}:${issuedAt}`;
  const hmac = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  const signedToken = `${Buffer.from(payload).toString("base64url")}.${hmac}`;

  res.cookie(`site_unlock_${site.id}`, signedToken, {
    httpOnly: true, secure: true, sameSite: "lax",
    maxAge: 24 * 60 * 60 * 1000,
  });

  res.json({ unlocked: true });
}));

export default router;
