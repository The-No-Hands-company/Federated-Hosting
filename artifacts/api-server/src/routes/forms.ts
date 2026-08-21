/**
 * Form submission backend.
 *
 * Allows static sites to POST form data without a custom backend.
 * Add this to any HTML form:
 *   <form action="https://your-node.example.com/api/forms/mysite.example.com/contact" method="POST">
 *
 * Features:
 *   - Accepts application/x-www-form-urlencoded and application/json
 *   - Basic spam detection (honeypot field, rate limit per IP)
 *   - Email notification to site owner on new submission
 *   - Stores all submissions in DB for dashboard review
 *   - CSV export for site owners
 *   - CORS headers so browser forms work cross-origin
 *
 * Routes (public):
 *   POST /api/forms/:domain/:formName  — submit a form
 *   OPTIONS /api/forms/:domain/:formName — CORS preflight
 *
 * Routes (authenticated):
 *   GET  /api/sites/:id/forms                 — list submissions
 *   GET  /api/sites/:id/forms/:formName        — submissions for a specific form
 *   GET  /api/sites/:id/forms/:formName/export — CSV export
 *   PATCH /api/sites/:id/forms/:submissionId   — mark as read / flag
 *   DELETE /api/sites/:id/forms/:submissionId  — delete submission
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod/v4";
import { db, sitesTable, formSubmissionsTable } from "@workspace/db";
import { eq, and, desc, count, sql } from "drizzle-orm";
import { asyncHandler, AppError } from "../lib/errors";
import { writeLimiter } from "../middleware/rateLimiter";
import { hashIp } from "../lib/analyticsFlush";
import { emailFormSubmission } from "../lib/email";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import logger from "../lib/logger";

const router: IRouter = Router();

// Strict per-IP rate limit for form submissions to deter spam
const formSubmitLimiter = rateLimit({
  windowMs: 60_000,
  max: process.env.NODE_ENV === "production" ? 5 : 1000,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? "0.0.0.0"),
  handler: (_req, res) => res.status(429).json({ error: "Too many submissions. Please wait." }),
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

// Additional per-site + per-IP limiter: max 3 submissions per IP per site per hour
const formSiteLimiter = rateLimit({
  windowMs: 60 * 60_000,
  max: process.env.NODE_ENV === "production" ? 3 : 1000,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip ?? "0.0.0.0")}:${req.params.domain ?? ""}:${req.params.formName ?? ""}`,
  handler: (_req, res) => res.status(429).json({ error: "Submission limit reached for this form. Please try again later." }),
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

// ── Spam scoring ──────────────────────────────────────────────────────────────

function scoreSpam(data: Record<string, string>): number {
  let score = 0;
  const values = Object.values(data).join(" ").toLowerCase();

  // Honeypot: if _gotcha or website field is filled, it's a bot
  if (data["_gotcha"] || data["website"] || data["url"]) score += 1.0;

  // Common spam patterns
  if (/https?:\/\//gi.test(values) && (values.match(/https?:\/\//g) ?? []).length > 2) score += 0.5;
  if (/\b(viagra|casino|crypto|bitcoin|forex|loan|prize|winner)\b/gi.test(values)) score += 0.6;
  if (/[^\x00-\x7F]/.test(values) && values.length > 200) score += 0.2; // high unicode ratio
  if (data["email"] && !/^[^@]+@[^@]+\.[^@]+$/.test(data["email"])) score += 0.4;

  return Math.min(score, 1.0);
}

// ── Public: receive form submission ───────────────────────────────────────────

router.options("/forms/:domain/:formName", (req: Request, res: Response) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.sendStatus(204);
});

router.post("/forms/:domain/:formName", formSubmitLimiter, formSiteLimiter, asyncHandler(async (req: Request, res: Response) => {
  const { domain, formName } = req.params as { domain: string; formName: string };

  // CORS — allow cross-origin submissions from the site itself
  res.setHeader("Access-Control-Allow-Origin", `https://${domain}`);

  const [site] = await db
    .select({ id: sitesTable.id, name: sitesTable.name, ownerEmail: sql<string>`(SELECT email FROM users WHERE id = ${sitesTable.ownerId})` })
    .from(sitesTable)
    .where(and(eq(sitesTable.domain, domain), eq(sitesTable.status, "active")));

  if (!site) {
    res.status(404).json({ error: "Site not found or not accepting submissions" });
    return;
  }

  // Parse form data (urlencoded or JSON)
  let rawData: Record<string, string> = {};
  const ct = req.headers["content-type"] ?? "";
  if (ct.includes("application/json")) {
    rawData = req.body as Record<string, string>;
  } else {
    rawData = req.body as Record<string, string>; // express urlencoded middleware handles this
  }

  // Strip system fields that shouldn't be stored
  const { _gotcha, _redirect, _subject, ...data } = rawData;

  // Validate that there's actually some content
  if (Object.keys(data).length === 0) {
    res.status(400).json({ error: "Empty submission" });
    return;
  }

  // Validate field values are strings and not too long
  for (const [key, val] of Object.entries(data)) {
    if (typeof val !== "string") { delete data[key]; continue; }
    if (val.length > 10_000) data[key] = val.slice(0, 10_000);
  }

  const spamScore = scoreSpam(rawData);
  const flagged = spamScore >= 0.5 ? 1 : 0;
  const ipHash = req.ip ? hashIp(req.ip) : null;

  const [submission] = await db.insert(formSubmissionsTable).values({
    siteId: site.id,
    formName: formName.slice(0, 100),
    data,
    ipHash,
    userAgent: (req.headers["user-agent"] ?? "").slice(0, 500),
    spamScore,
    flagged,
  }).returning({ id: formSubmissionsTable.id });

  logger.info({ siteId: site.id, formName, spamScore, flagged }, "[forms] Submission received");

  // Notify site owner (skip if spam)
  if (!flagged && site.ownerEmail) {
    emailFormSubmission?.({
      to: site.ownerEmail,
      siteName: site.name,
      domain,
      formName,
      data,
    }).catch(() => {});
  }

  // Fire webhooks registered for this site (non-blocking)
  if (!flagged) {
    import("@workspace/db").then(async ({ webhooksTable }) => {
      const { eq: eqFn, and: andFn } = await import("drizzle-orm");
      const hooks = await db.select({ url: webhooksTable.url, secret: webhooksTable.secret })
        .from(webhooksTable)
        .where(andFn(eqFn(webhooksTable.siteId, site.id), eqFn(webhooksTable.enabled, 1)));

      for (const hook of hooks) {
        const payload = JSON.stringify({
          event: "form.submission",
          formName,
          domain,
          data,
          submittedAt: new Date().toISOString(),
        });
        const sig = hook.secret
          ? require("crypto").createHmac("sha256", hook.secret).update(payload).digest("hex")
          : "";
        fetch(hook.url, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(sig ? { "X-Webhook-Signature": sig } : {}) },
          body: payload,
          signal: AbortSignal.timeout(8000),
        }).catch(() => {});
      }
    }).catch(() => {});
  }

  // Redirect if _redirect was set, otherwise JSON response
  if (_redirect) {
    res.redirect(302, _redirect);
  } else {
    res.json({ ok: true, id: submission.id });
  }
}));

// ── Authenticated: manage submissions ─────────────────────────────────────────

router.get("/sites/:id/forms", asyncHandler(async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();
  const siteId = parseInt(req.params.id as string, 10);
  if (isNaN(siteId)) throw AppError.badRequest("Invalid site ID");

  const [site] = await db.select({ ownerId: sitesTable.ownerId }).from(sitesTable).where(eq(sitesTable.id, siteId));
  if (!site) throw AppError.notFound("Site not found");
  if (site.ownerId !== req.user.id) throw AppError.forbidden();

  const page  = Math.max(1, parseInt((req.query.page as string) || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || "50", 10)));
  const formName = req.query.form as string | undefined;

  const where = formName
    ? and(eq(formSubmissionsTable.siteId, siteId), eq(formSubmissionsTable.formName, formName))
    : eq(formSubmissionsTable.siteId, siteId);

  const [{ total }] = await db.select({ total: count() }).from(formSubmissionsTable).where(where);

  const submissions = await db.select().from(formSubmissionsTable)
    .where(where)
    .orderBy(desc(formSubmissionsTable.createdAt))
    .limit(limit).offset((page - 1) * limit);

  // Group by form name for overview
  const formCounts = await db
    .select({ formName: formSubmissionsTable.formName, count: count() })
    .from(formSubmissionsTable)
    .where(eq(formSubmissionsTable.siteId, siteId))
    .groupBy(formSubmissionsTable.formName);

  res.json({ data: submissions, meta: { total: Number(total), page, limit }, forms: formCounts });
}));

router.get("/sites/:id/forms/:formName/export", asyncHandler(async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();
  const siteId = parseInt(req.params.id as string, 10);
  if (isNaN(siteId)) throw AppError.badRequest("Invalid site ID");

  const [site] = await db.select({ ownerId: sitesTable.ownerId, domain: sitesTable.domain }).from(sitesTable).where(eq(sitesTable.id, siteId));
  if (!site) throw AppError.notFound("Site not found");
  if (site.ownerId !== req.user.id) throw AppError.forbidden();

  const { formName } = req.params as { formName: string };
  const submissions = await db.select().from(formSubmissionsTable)
    .where(and(eq(formSubmissionsTable.siteId, siteId), eq(formSubmissionsTable.formName, formName)))
    .orderBy(desc(formSubmissionsTable.createdAt));

  if (submissions.length === 0) {
    res.status(404).json({ error: "No submissions found" });
    return;
  }

  // Collect all field names
  const allFields = new Set<string>();
  submissions.forEach(s => Object.keys(s.data as object).forEach(k => allFields.add(k)));
  const fields = ["id", "created_at", ...Array.from(allFields), "spam_score", "flagged"];

  const escape = (v: unknown) => {
    if (v == null) return "";
    const s = String(v).replace(/"/g, '""');
    return s.includes(",") || s.includes("\n") || s.includes('"') ? `"${s}"` : s;
  };

  const rows = [
    fields.join(","),
    ...submissions.map(s =>
      fields.map(f => {
        if (f === "id") return escape(s.id);
        if (f === "created_at") return escape(s.createdAt?.toISOString());
        if (f === "spam_score") return escape(s.spamScore);
        if (f === "flagged") return escape(s.flagged);
        return escape((s.data as Record<string, string>)[f] ?? "");
      }).join(",")
    ),
  ].join("\n");

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="${site.domain}-${formName}.csv"`);
  res.send(rows);
}));

router.patch("/sites/:id/forms/:submissionId", writeLimiter, asyncHandler(async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();
  const siteId = parseInt(req.params.id as string, 10);
  const submissionId = parseInt(req.params.submissionId as string, 10);
  if (isNaN(siteId) || isNaN(submissionId)) throw AppError.badRequest("Invalid ID");

  const [site] = await db.select({ ownerId: sitesTable.ownerId }).from(sitesTable).where(eq(sitesTable.id, siteId));
  if (!site) throw AppError.notFound("Site not found");
  if (site.ownerId !== req.user.id) throw AppError.forbidden();

  const { read, flagged } = z.object({
    read:    z.number().int().min(0).max(1).optional(),
    flagged: z.number().int().min(0).max(1).optional(),
  }).parse(req.body);

  const updates: Record<string, number> = {};
  if (read    !== undefined) updates.read    = read;
  if (flagged !== undefined) updates.flagged = flagged;

  if (Object.keys(updates).length === 0) throw AppError.badRequest("No fields to update");

  const [updated] = await db.update(formSubmissionsTable)
    .set(updates)
    .where(and(eq(formSubmissionsTable.id, submissionId), eq(formSubmissionsTable.siteId, siteId)))
    .returning();

  res.json(updated);
}));

router.delete("/sites/:id/forms/:submissionId", writeLimiter, asyncHandler(async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();
  const siteId = parseInt(req.params.id as string, 10);
  const submissionId = parseInt(req.params.submissionId as string, 10);
  if (isNaN(siteId) || isNaN(submissionId)) throw AppError.badRequest("Invalid ID");

  const [site] = await db.select({ ownerId: sitesTable.ownerId }).from(sitesTable).where(eq(sitesTable.id, siteId));
  if (!site) throw AppError.notFound("Site not found");
  if (site.ownerId !== req.user.id) throw AppError.forbidden();

  await db.delete(formSubmissionsTable)
    .where(and(eq(formSubmissionsTable.id, submissionId), eq(formSubmissionsTable.siteId, siteId)));
  res.sendStatus(204);
}));

export default router;
