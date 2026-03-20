/**
 * Site environment variables.
 *
 * Stored env vars are automatically injected into build pipeline jobs.
 * Secret vars are masked in list responses (value shown as ***).
 *
 * Routes:
 *   GET    /api/sites/:id/env          — list (secrets masked unless ?showSecrets=1)
 *   POST   /api/sites/:id/env          — set / upsert
 *   DELETE /api/sites/:id/env/:key     — remove one var
 *   DELETE /api/sites/:id/env          — remove all vars
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod/v4";
import { db, sitesTable, siteEnvVarsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { asyncHandler, AppError } from "../lib/errors";
import { writeLimiter } from "../middleware/rateLimiter";

const router: IRouter = Router();

const KEY_RE = /^[A-Z_][A-Z0-9_]{0,99}$/;

const EnvVarBody = z.object({
  key:    z.string().regex(KEY_RE, "Key must be uppercase letters, digits, and underscores (e.g. VITE_API_URL)"),
  value:  z.string().max(10_000),
  secret: z.number().int().min(0).max(1).default(0),
});

async function requireOwner(siteId: number, userId: string) {
  const [site] = await db.select({ ownerId: sitesTable.ownerId })
    .from(sitesTable).where(eq(sitesTable.id, siteId));
  if (!site) throw AppError.notFound("Site not found");
  if (site.ownerId !== userId) throw AppError.forbidden();
}

router.get("/sites/:id/env", asyncHandler(async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();
  const siteId = parseInt(req.params.id as string, 10);
  if (isNaN(siteId)) throw AppError.badRequest("Invalid site ID");
  await requireOwner(siteId, req.user.id);

  const showSecrets = req.query.showSecrets === "1" || req.query.showSecrets === "true";

  const vars = await db.select().from(siteEnvVarsTable)
    .where(eq(siteEnvVarsTable.siteId, siteId))
    .orderBy(siteEnvVarsTable.key);

  res.json(vars.map(v => ({
    ...v,
    value: v.secret && !showSecrets ? "***" : v.value,
  })));
}));

router.post("/sites/:id/env", writeLimiter, asyncHandler(async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();
  const siteId = parseInt(req.params.id as string, 10);
  if (isNaN(siteId)) throw AppError.badRequest("Invalid site ID");
  await requireOwner(siteId, req.user.id);

  const parsed = EnvVarBody.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest(parsed.error.message);

  // Block overwriting dangerous server-side vars that build env stripping relies on
  const BLOCKED = ["DATABASE_URL", "REDIS_URL", "SMTP_PASS", "SESSION_SECRET",
                   "COOKIE_SECRET", "OBJECT_STORAGE_SECRET_ACCESS_KEY", "ISSUER_URL"];
  if (BLOCKED.includes(parsed.data.key)) {
    throw AppError.badRequest(`Cannot set reserved variable: ${parsed.data.key}`, "RESERVED_KEY");
  }

  const [result] = await db.insert(siteEnvVarsTable)
    .values({ siteId, ...parsed.data })
    .onConflictDoUpdate({
      target: [siteEnvVarsTable.siteId, siteEnvVarsTable.key],
      set: { value: parsed.data.value, secret: parsed.data.secret },
    })
    .returning();

  res.status(201).json({ ...result, value: result.secret ? "***" : result.value });
}));

router.delete("/sites/:id/env/:key", writeLimiter, asyncHandler(async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();
  const siteId = parseInt(req.params.id as string, 10);
  if (isNaN(siteId)) throw AppError.badRequest("Invalid site ID");
  await requireOwner(siteId, req.user.id);

  const key = decodeURIComponent(req.params.key as string);
  await db.delete(siteEnvVarsTable)
    .where(and(eq(siteEnvVarsTable.siteId, siteId), eq(siteEnvVarsTable.key, key)));
  res.sendStatus(204);
}));

router.delete("/sites/:id/env", writeLimiter, asyncHandler(async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();
  const siteId = parseInt(req.params.id as string, 10);
  if (isNaN(siteId)) throw AppError.badRequest("Invalid site ID");
  await requireOwner(siteId, req.user.id);

  await db.delete(siteEnvVarsTable).where(eq(siteEnvVarsTable.siteId, siteId));
  res.sendStatus(204);
}));

export default router;
