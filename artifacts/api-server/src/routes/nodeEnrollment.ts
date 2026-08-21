import { Router, type IRouter } from "express";
import crypto from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db, nodesTable, nodeEnrollmentTokensTable } from "@workspace/db";
import { z } from "zod";
import { serializeDates } from "../lib/serialize";
import { asyncHandler, AppError } from "../lib/errors";
import { verifySignature } from "../lib/federation";
import { writeLimiter } from "../middleware/rateLimiter";
import logger from "../lib/logger";

const router: IRouter = Router();

/** How long an unclaimed enrolment token stays valid. */
const ENROLLMENT_TTL_HOURS = 24;

/**
 * Hash a token for storage and lookup.
 *
 * SHA-256 is right here where a password hash would not be: the token is 32
 * bytes from a CSPRNG, so there is no dictionary to attack and nothing for a
 * slow KDF to buy. What matters is that the stored value cannot be replayed.
 */
function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

const EnrollBody = z.object({
  name: z.string().min(1),
  domain: z.string().min(1),
  region: z.string().min(1),
  operatorName: z.string().min(1),
  operatorEmail: z.string().email(),
  storageCapacityGb: z.number().positive(),
  bandwidthCapacityGb: z.number().positive(),
  description: z.string().optional(),
});

/**
 * Begin enrolling a node.
 *
 * Creates a `pending` row with no keys at all and issues one single-use token.
 * The server deliberately does not generate a keypair: the whole point is that
 * the node's identity is minted on the operator's machine and this service
 * never sees the private half.
 *
 * The token is returned exactly once. It is stored hashed, so it cannot be
 * recovered from the database or from this response later.
 */
router.post("/nodes/enroll", writeLimiter, asyncHandler(async (req, res) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();

  const parsed = EnrollBody.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest(parsed.error.message);

  const [existing] = await db
    .select({ id: nodesTable.id })
    .from(nodesTable)
    .where(eq(nodesTable.domain, parsed.data.domain));

  if (existing) {
    throw AppError.conflict(`A node already exists for ${parsed.data.domain}.`);
  }

  const [node] = await db
    .insert(nodesTable)
    .values({
      ...parsed.data,
      status: "pending",
      // No publicKey, and emphatically no privateKey. Both stay null until a
      // machine proves it holds a key by claiming the token below.
      publicKey: null,
      privateKey: null,
    })
    .returning();

  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + ENROLLMENT_TTL_HOURS * 60 * 60 * 1000);

  await db.insert(nodeEnrollmentTokensTable).values({
    nodeId: node.id,
    tokenHash: hashToken(token),
    createdBy: req.user.id,
    expiresAt,
  });

  const apiBase = process.env.PUBLIC_API_URL ?? `https://hosting.${process.env.PUBLIC_DOMAIN ?? "tnhc.dev"}`;

  logger.info({ nodeId: node.id, domain: node.domain }, "[enrollment] Node enrolment started");

  const { privateKey: _pk, ...safeNode } = node;
  res.status(201).json({
    node: serializeDates(safeNode),
    // Shown once. There is no endpoint that returns this again.
    enrollmentToken: token,
    expiresAt: expiresAt.toISOString(),
    installCommand: `curl -fsSL ${apiBase}/install-node.sh -o install-node.sh && sh install-node.sh --token ${token} --api ${apiBase}`,
  });
}));

const ClaimBody = z.object({
  token: z.string().min(1),
  /** SPKI PEM, Ed25519. Generated on the node, never by this service. */
  publicKey: z.string().min(1),
  /** base64 signature over the token, made with the matching private key. */
  signature: z.string().min(1),
});

/**
 * Claim a pending node with a locally generated key.
 *
 * Deliberately not session-authenticated: the machine being enrolled is not a
 * browser and has no session. The token is the authorisation, which is why it
 * is single-use, short-lived, and stored hashed.
 *
 * The signature is what makes this more than "assert a public key". Without
 * it, a caller holding the token could register any public key, including one
 * belonging to somebody else — and since the federation handshake trusts a
 * node's registered key, that would let the key's real owner impersonate this
 * node to every peer. Signing the token proves the caller holds the private
 * half of the key it is registering.
 */
router.post("/nodes/claim", writeLimiter, asyncHandler(async (req, res) => {
  const parsed = ClaimBody.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest(parsed.error.message);

  const { token, publicKey, signature } = parsed.data;

  const [record] = await db
    .select()
    .from(nodeEnrollmentTokensTable)
    .where(and(
      eq(nodeEnrollmentTokensTable.tokenHash, hashToken(token)),
      isNull(nodeEnrollmentTokensTable.claimedAt),
      isNull(nodeEnrollmentTokensTable.revokedAt),
    ));

  // One message for "no such token", "already used" and "revoked". Telling a
  // caller which of those applies confirms that a token existed, which is
  // information they should not get from guessing.
  if (!record) throw AppError.unauthorized("Invalid or already-used enrolment token.");

  if (record.expiresAt.getTime() < Date.now()) {
    throw AppError.unauthorized("Enrolment token has expired. Ask an operator to issue another.");
  }

  if (!verifySignature(publicKey, token, signature)) {
    throw AppError.badRequest(
      "Signature does not verify against the supplied public key. The node must sign its enrolment token with the private key it generated.",
    );
  }

  const [node] = await db
    .update(nodesTable)
    .set({
      publicKey,
      status: "active",
      verifiedAt: new Date(),
      lastSeenAt: new Date(),
    })
    .where(eq(nodesTable.id, record.nodeId))
    .returning();

  if (!node) throw AppError.notFound("The node this token refers to no longer exists.");

  // Spend the token. A claim that reached this point must not be replayable
  // even if the same token is submitted again a moment later.
  await db
    .update(nodeEnrollmentTokensTable)
    .set({ claimedAt: new Date() })
    .where(eq(nodeEnrollmentTokensTable.id, record.id));

  logger.info({ nodeId: node.id, domain: node.domain }, "[enrollment] Node claimed and activated");

  const { privateKey: _pk, ...safeNode } = node;
  res.json({ node: serializeDates(safeNode) });
}));

/** Revoke an unclaimed token, for a lost or mistakenly issued enrolment. */
router.post("/nodes/:id/enrollment/revoke", writeLimiter, asyncHandler(async (req, res) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();

  const nodeId = Number(req.params.id);
  if (!Number.isInteger(nodeId)) throw AppError.badRequest("Invalid node id.");

  const revoked = await db
    .update(nodeEnrollmentTokensTable)
    .set({ revokedAt: new Date() })
    .where(and(
      eq(nodeEnrollmentTokensTable.nodeId, nodeId),
      isNull(nodeEnrollmentTokensTable.claimedAt),
      isNull(nodeEnrollmentTokensTable.revokedAt),
    ))
    .returning({ id: nodeEnrollmentTokensTable.id });

  res.json({ revoked: revoked.length });
}));

export default router;
