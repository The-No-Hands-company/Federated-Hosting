/**
 * Git webhook receiver — auto-deploy on push.
 *
 * Accepts push events from GitHub and GitLab and triggers the build
 * pipeline for the matching site. Each site registers a webhook secret
 * in its env vars (GIT_WEBHOOK_SECRET) which is used to verify the
 * incoming request signature.
 *
 * Setup (GitHub):
 *   Repository → Settings → Webhooks → Add webhook
 *   Payload URL: https://your-node.com/api/git-webhook/:siteId
 *   Content type: application/json
 *   Secret: (any random string — store as GIT_WEBHOOK_SECRET env var on the site)
 *   Events: Just the push event
 *
 * Setup (GitLab):
 *   Project → Settings → Webhooks
 *   URL: https://your-node.com/api/git-webhook/:siteId
 *   Secret token: same secret
 *   Trigger: Push events
 *
 * Routes:
 *   POST /api/git-webhook/:siteId — receive push event and trigger build
 */

import { Router, type IRouter, type Request, type Response } from "express";
import crypto from "crypto";
import { db, sitesTable, buildJobsTable, siteEnvVarsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { asyncHandler, AppError } from "../lib/errors";
import logger from "../lib/logger";
import { runBuild } from "./builds";

const router: IRouter = Router();

function verifyGitHubSignature(secret: string, body: string, sig: string): boolean {
  if (!sig.startsWith("sha256=")) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch { return false; }
}

function verifyGitLabToken(secret: string, token: string): boolean {
  try {
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(secret));
  } catch { return false; }
}

router.post("/git-webhook/:siteId", asyncHandler(async (req: Request, res: Response) => {
  const siteId = parseInt(req.params.siteId as string, 10);
  if (isNaN(siteId)) throw AppError.badRequest("Invalid site ID");

  const [site] = await db.select().from(sitesTable).where(eq(sitesTable.id, siteId));
  if (!site) { res.sendStatus(404); return; }

  // Look up the webhook secret from the site's env vars
  const [secretVar] = await db.select({ value: siteEnvVarsTable.value })
    .from(siteEnvVarsTable)
    .where(and(eq(siteEnvVarsTable.siteId, siteId), eq(siteEnvVarsTable.key, "GIT_WEBHOOK_SECRET")));

  if (!secretVar) {
    logger.warn({ siteId }, "[git-webhook] No GIT_WEBHOOK_SECRET configured — rejecting");
    res.status(403).json({ error: "No GIT_WEBHOOK_SECRET env var configured for this site." });
    return;
  }

  const secret  = secretVar.value;
  const rawBody = JSON.stringify(req.body); // express already parsed it

  // Detect provider and verify signature
  const githubSig = req.headers["x-hub-signature-256"] as string | undefined;
  const gitlabToken = req.headers["x-gitlab-token"] as string | undefined;
  const gitlabEvent = req.headers["x-gitlab-event"] as string | undefined;
  const githubEvent = req.headers["x-github-event"] as string | undefined;

  if (githubSig) {
    if (!verifyGitHubSignature(secret, rawBody, githubSig)) {
      logger.warn({ siteId }, "[git-webhook] GitHub signature verification failed");
      res.status(401).json({ error: "Invalid signature" });
      return;
    }
    if (githubEvent !== "push") {
      res.json({ ok: true, skipped: `Event '${githubEvent}' ignored (only 'push' triggers builds)` });
      return;
    }
  } else if (gitlabToken) {
    if (!verifyGitLabToken(secret, gitlabToken)) {
      logger.warn({ siteId }, "[git-webhook] GitLab token verification failed");
      res.status(401).json({ error: "Invalid token" });
      return;
    }
    if (gitlabEvent !== "Push Hook") {
      res.json({ ok: true, skipped: `Event '${gitlabEvent}' ignored (only 'Push Hook' triggers builds)` });
      return;
    }
  } else {
    res.status(401).json({ error: "No recognisable signature header (X-Hub-Signature-256 or X-Gitlab-Token)" });
    return;
  }

  // Extract branch and repo URL from payload
  const payload = req.body as any;
  const pushedBranch = (payload.ref as string | undefined)?.replace("refs/heads/", "") ?? "main";
  const repoUrl      = payload.repository?.clone_url   // GitHub
                    ?? payload.repository?.git_http_url // GitLab
                    ?? null;

  // Look up build config from site env vars
  const envVars = await db.select({ key: siteEnvVarsTable.key, value: siteEnvVarsTable.value })
    .from(siteEnvVarsTable).where(eq(siteEnvVarsTable.siteId, siteId));
  const env = Object.fromEntries(envVars.map(v => [v.key, v.value]));

  const buildBranch   = env["BUILD_BRANCH"]   ?? "main";
  const buildCommand  = env["BUILD_COMMAND"]  ?? "npm run build";
  const outputDir     = env["BUILD_OUTPUT"]   ?? "dist";
  const gitUrl        = repoUrl ?? env["GIT_URL"] ?? null;

  // Only build if pushed branch matches configured build branch
  if (pushedBranch !== buildBranch) {
    logger.info({ siteId, pushedBranch, buildBranch }, "[git-webhook] Branch mismatch — skipping build");
    res.json({ ok: true, skipped: `Push to '${pushedBranch}' ignored (BUILD_BRANCH=${buildBranch})` });
    return;
  }

  if (!gitUrl) {
    res.status(422).json({ error: "No git URL available. Set GIT_URL in site env vars." });
    return;
  }

  // Check for already-running build
  const [running] = await db.select({ id: buildJobsTable.id }).from(buildJobsTable)
    .where(and(eq(buildJobsTable.siteId, siteId), eq(buildJobsTable.status, "running")));
  if (running) {
    logger.info({ siteId }, "[git-webhook] Build already running — skipping");
    res.json({ ok: true, skipped: "A build is already running" });
    return;
  }

  const [owner] = await db
    .select({ id: sitesTable.ownerId })
    .from(sitesTable).where(eq(sitesTable.id, siteId));

  const [job] = await db.insert(buildJobsTable).values({
    siteId,
    triggeredBy: owner?.id ?? "webhook",
    gitUrl,
    gitBranch: pushedBranch,
    buildCommand,
    outputDir,
    status: "queued",
  }).returning();

  logger.info({ siteId, branch: pushedBranch, buildId: job.id }, "[git-webhook] Build triggered");

  // Run async — webhook must respond within a few seconds
  res.json({ ok: true, buildId: job.id, branch: pushedBranch });

  runBuild(job.id, siteId, {
    gitUrl,
    gitBranch: pushedBranch,
    buildCommand,
    outputDir,
    environment: "production",
    installCommand: env["BUILD_INSTALL"] ?? undefined,
    envVars: Object.fromEntries(
      Object.entries(env).filter(([k]) =>
        !["GIT_WEBHOOK_SECRET", "GIT_URL", "BUILD_BRANCH", "BUILD_COMMAND",
          "BUILD_OUTPUT", "BUILD_INSTALL"].includes(k)
      )
    ),
    userId: owner?.id ?? "webhook",
    siteName: site.name,
    siteDomain: site.domain,
  }).catch(err => logger.error({ err, buildId: job.id }, "[git-webhook] Build error"));
}));

export default router;
