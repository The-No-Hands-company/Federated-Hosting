import { Router, type IRouter, type Request, type Response } from "express";
import { db, apiTokensTable } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import { asyncHandler, AppError } from "../lib/errors";
import { tokenLimiter, writeLimiter } from "../middleware/rateLimiter";
import crypto from "crypto";
import { z } from "zod/v4";

const router: IRouter = Router();

const VALID_SCOPES = ["read", "write", "deploy", "admin"] as const;

const CreateTokenBody = z.object({
  name:          z.string().min(1).max(80),
  expiresInDays: z.number().int().min(1).max(365).optional(),
  scopes:        z.array(z.enum(VALID_SCOPES)).min(1).default(["read", "write", "deploy"]),
});

/**
 * Verify a plaintext token against its stored hash.
 * We use SHA-256 here (not bcrypt) for speed on every request.
 * The token itself is 32 random bytes so brute-force is infeasible.
 */
export function hashToken(plaintext: string): string {
  return crypto.createHash("sha256").update(plaintext).digest("hex");
}

function generateToken(): string {
  return `fh_${crypto.randomBytes(32).toString("hex")}`;
}

/** GET /api/tokens — list caller's tokens (hashes never returned) */
router.get("/tokens", asyncHandler(async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();

  const tokens = await db
    .select({
      id: apiTokensTable.id,
      name: apiTokensTable.name,
      tokenPrefix: apiTokensTable.tokenPrefix,
      lastUsedAt: apiTokensTable.lastUsedAt,
      expiresAt: apiTokensTable.expiresAt,
      createdAt: apiTokensTable.createdAt,
      revokedAt: apiTokensTable.revokedAt,
    })
    .from(apiTokensTable)
    .where(and(eq(apiTokensTable.userId, req.user.id), isNull(apiTokensTable.revokedAt)))
    .orderBy(apiTokensTable.createdAt);

  res.json(tokens);
}));

/** POST /api/tokens — create a new token; plaintext returned ONCE */
router.post("/tokens", tokenLimiter, asyncHandler(async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();

  const parsed = CreateTokenBody.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest(parsed.error.message);

  const plaintext = generateToken();
  const tokenHash = hashToken(plaintext);
  const tokenPrefix = plaintext.slice(0, 10); // "nh_" + 7 chars

  const expiresAt = parsed.data.expiresInDays
    ? new Date(Date.now() + parsed.data.expiresInDays * 86400_000)
    : null;

  const [token] = await db
    .insert(apiTokensTable)
    .values({
      userId: req.user.id,
      name: parsed.data.name,
      tokenHash,
      tokenPrefix,
      scopes: parsed.data.scopes.join(","),
      ...(expiresAt ? { expiresAt } : {}),
    })
    .returning({
      id:          apiTokensTable.id,
      name:        apiTokensTable.name,
      tokenPrefix: apiTokensTable.tokenPrefix,
      scopes:      apiTokensTable.scopes,
      expiresAt:   apiTokensTable.expiresAt,
      createdAt:   apiTokensTable.createdAt,
    });

  // Return plaintext only this once
  res.status(201).json({ ...token, token: plaintext });
}));

/** DELETE /api/tokens/:id — revoke a token */
router.delete("/tokens/:id", writeLimiter, asyncHandler(async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();

  const id = parseInt(req.params.id as string, 10);
  if (Number.isNaN(id)) throw AppError.badRequest("Invalid token ID");

  const [token] = await db
    .select({ id: apiTokensTable.id, userId: apiTokensTable.userId })
    .from(apiTokensTable)
    .where(eq(apiTokensTable.id, id));

  if (!token) throw AppError.notFound("Token not found");
  if (token.userId !== req.user.id) throw AppError.forbidden();

  await db
    .update(apiTokensTable)
    .set({ revokedAt: new Date() })
    .where(eq(apiTokensTable.id, id));

  res.sendStatus(204);
}));

export default router;
