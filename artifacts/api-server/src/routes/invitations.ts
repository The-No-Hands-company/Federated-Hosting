/**
 * Site invitation routes.
 *
 * Invitations allow site owners to add collaborators by email address,
 * even before the invitee has a NexusHosting account.
 *
 * Flow:
 *   1. Owner POSTs /api/sites/:id/invitations with email + role
 *   2. System creates a signed token and sends an invitation email
 *   3. Invitee clicks the link → GET /api/invitations/:token
 *   4. Invitee accepts → POST /api/invitations/:token/accept (must be authenticated)
 *   5. Site member record is created with acceptedAt set
 *
 * Routes:
 *   POST /api/sites/:id/invitations          — send invitation email
 *   GET  /api/sites/:id/invitations          — list pending invitations
 *   DELETE /api/sites/:id/invitations/:id    — revoke an invitation
 *   GET  /api/invitations/:token             — get invitation details (unauthenticated)
 *   POST /api/invitations/:token/accept      — accept invitation (authenticated)
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod/v4";
import crypto from "crypto";
import { db, sitesTable, siteInvitationsTable, siteMembersTable, usersTable } from "@workspace/db";
import { eq, and, isNull, gt } from "drizzle-orm";
import { asyncHandler, AppError } from "../lib/errors";
import { writeLimiter, tokenLimiter } from "../middleware/rateLimiter";
import { emailInvitation } from "../lib/email";
import logger from "../lib/logger";

const router: IRouter = Router();
const INVITATION_TTL_DAYS = 7;

const InviteBody = z.object({
  email: z.string().email("Invalid email address"),
  role:  z.enum(["editor", "viewer"]).default("viewer"),
});

// ── Send invitation ───────────────────────────────────────────────────────────

router.post("/sites/:id/invitations", tokenLimiter, asyncHandler(async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();

  const siteId = parseInt(req.params.id as string, 10);
  if (Number.isNaN(siteId)) throw AppError.badRequest("Invalid site ID");

  const [site] = await db
    .select({ id: sitesTable.id, name: sitesTable.name, domain: sitesTable.domain, ownerId: sitesTable.ownerId })
    .from(sitesTable).where(eq(sitesTable.id, siteId));

  if (!site) throw AppError.notFound("Site not found");
  if (site.ownerId !== req.user.id) throw AppError.forbidden("Only the site owner can send invitations");

  const parsed = InviteBody.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest(parsed.error.message);
  const { email, role } = parsed.data;

  // Check for existing non-expired pending invitation
  const [existing] = await db
    .select({ id: siteInvitationsTable.id })
    .from(siteInvitationsTable)
    .where(and(
      eq(siteInvitationsTable.siteId, siteId),
      eq(siteInvitationsTable.email, email),
      isNull(siteInvitationsTable.acceptedAt),
      gt(siteInvitationsTable.expiresAt, new Date()),
    ));

  if (existing) {
    throw AppError.conflict("A pending invitation for this email already exists. Revoke it first to resend.");
  }

  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);

  const [invitation] = await db.insert(siteInvitationsTable)
    .values({ siteId, invitedBy: req.user.id, email, role, token, expiresAt })
    .returning();

  // Build accept URL
  const domain = process.env.PUBLIC_DOMAIN ?? "localhost";
  const acceptUrl = `https://${domain}/accept-invitation?token=${token}`;

  // Send email (fire-and-forget — invitation is created regardless)
  const inviterName = req.user.firstName ?? req.user.email ?? "A site owner";
  emailInvitation({ to: email, inviterName, siteName: site.name, domain: site.domain, role, acceptUrl })
    .then(sent => {
      if (!sent) logger.warn({ email, siteId }, "[invitation] Email not sent (SMTP not configured)");
    })
    .catch(() => {});

  logger.info({ email, siteId, role }, "[invitation] Invitation created");
  res.status(201).json({
    id: invitation.id,
    email,
    role,
    expiresAt: invitation.expiresAt,
    // Only return the accept URL in development (don't leak tokens in production logs)
    ...(process.env.NODE_ENV !== "production" ? { acceptUrl } : {}),
  });
}));

// ── List pending invitations ──────────────────────────────────────────────────

router.get("/sites/:id/invitations", asyncHandler(async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();

  const siteId = parseInt(req.params.id as string, 10);
  if (Number.isNaN(siteId)) throw AppError.badRequest("Invalid site ID");

  const [site] = await db.select({ ownerId: sitesTable.ownerId }).from(sitesTable).where(eq(sitesTable.id, siteId));
  if (!site) throw AppError.notFound("Site not found");
  if (site.ownerId !== req.user.id) throw AppError.forbidden();

  const invitations = await db
    .select({
      id:          siteInvitationsTable.id,
      email:       siteInvitationsTable.email,
      role:        siteInvitationsTable.role,
      acceptedAt:  siteInvitationsTable.acceptedAt,
      expiresAt:   siteInvitationsTable.expiresAt,
      createdAt:   siteInvitationsTable.createdAt,
    })
    .from(siteInvitationsTable)
    .where(and(
      eq(siteInvitationsTable.siteId, siteId),
      isNull(siteInvitationsTable.acceptedAt),
    ))
    .orderBy(siteInvitationsTable.createdAt);

  res.json(invitations);
}));

// ── Revoke invitation ─────────────────────────────────────────────────────────

router.delete("/sites/:id/invitations/:inviteId", writeLimiter, asyncHandler(async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();

  const siteId    = parseInt(req.params.id as string, 10);
  const inviteId  = parseInt(req.params.inviteId as string, 10);
  if (Number.isNaN(siteId) || Number.isNaN(inviteId)) throw AppError.badRequest("Invalid ID");

  const [site] = await db.select({ ownerId: sitesTable.ownerId }).from(sitesTable).where(eq(sitesTable.id, siteId));
  if (!site) throw AppError.notFound("Site not found");
  if (site.ownerId !== req.user.id) throw AppError.forbidden();

  await db.delete(siteInvitationsTable)
    .where(and(eq(siteInvitationsTable.id, inviteId), eq(siteInvitationsTable.siteId, siteId)));

  res.sendStatus(204);
}));

// ── Get invitation details (unauthenticated) ──────────────────────────────────

router.get("/invitations/:token", asyncHandler(async (req: Request, res: Response) => {
  const { token } = req.params;

  const [inv] = await db
    .select({
      id:        siteInvitationsTable.id,
      email:     siteInvitationsTable.email,
      role:      siteInvitationsTable.role,
      expiresAt: siteInvitationsTable.expiresAt,
      acceptedAt:siteInvitationsTable.acceptedAt,
      siteName:  sitesTable.name,
      domain:    sitesTable.domain,
      inviterEmail: usersTable.email,
      inviterName:  usersTable.firstName,
    })
    .from(siteInvitationsTable)
    .innerJoin(sitesTable, eq(sitesTable.id, siteInvitationsTable.siteId))
    .innerJoin(usersTable, eq(usersTable.id, siteInvitationsTable.invitedBy))
    .where(eq(siteInvitationsTable.token, token));

  if (!inv) throw AppError.notFound("Invitation not found or expired");
  if (inv.acceptedAt) throw AppError.badRequest("This invitation has already been accepted", "ALREADY_ACCEPTED");
  if (inv.expiresAt < new Date()) throw AppError.badRequest("This invitation has expired", "INVITATION_EXPIRED");

  // Don't expose the token in the response
  const { ...safe } = inv;
  res.json(safe);
}));

// ── Accept invitation ─────────────────────────────────────────────────────────

router.post("/invitations/:token/accept", writeLimiter, asyncHandler(async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized("Sign in to accept this invitation");

  const { token } = req.params;

  const [inv] = await db
    .select()
    .from(siteInvitationsTable)
    .where(eq(siteInvitationsTable.token, token));

  if (!inv) throw AppError.notFound("Invitation not found");
  if (inv.acceptedAt) throw AppError.badRequest("This invitation has already been accepted", "ALREADY_ACCEPTED");
  if (inv.expiresAt < new Date()) throw AppError.badRequest("This invitation has expired", "INVITATION_EXPIRED");

  // Check the authenticated user's email matches the invitation
  // Allow mismatch in dev but enforce in production
  if (process.env.NODE_ENV === "production" && req.user.email !== inv.email) {
    throw AppError.forbidden("This invitation was sent to a different email address");
  }

  // Check not already a member
  const [existing] = await db
    .select({ id: siteMembersTable.id })
    .from(siteMembersTable)
    .where(and(eq(siteMembersTable.siteId, inv.siteId), eq(siteMembersTable.userId, req.user.id)));

  if (existing) {
    // Mark invitation accepted even if already a member
    await db.update(siteInvitationsTable)
      .set({ acceptedAt: new Date() })
      .where(eq(siteInvitationsTable.id, inv.id));
    throw AppError.conflict("You are already a member of this site");
  }

  // Create membership and mark invitation accepted in a transaction
  const [member] = await db.transaction(async (tx) => {
    await tx.update(siteInvitationsTable)
      .set({ acceptedAt: new Date() })
      .where(eq(siteInvitationsTable.id, inv.id));

    return tx.insert(siteMembersTable)
      .values({
        siteId: inv.siteId,
        userId: req.user.id,
        role: inv.role,
        invitedByUserId: inv.invitedBy,
        acceptedAt: new Date(),
      })
      .returning();
  });

  logger.info({ siteId: inv.siteId, userId: req.user.id, role: inv.role }, "[invitation] Accepted");
  res.json({ accepted: true, member });
}));

export default router;
