/**
 * Build pipeline — run npm/yarn/pnpm build from a Git repository.
 *
 * Operators can connect a Git repo and trigger builds that automatically:
 *   1. Clone / pull the repo at the specified branch
 *   2. Install dependencies (npm/yarn/pnpm auto-detected)
 *   3. Run the build command
 *   4. Deploy the output directory as a new site deployment
 *
 * Builds run in an isolated temp directory and are cleaned up after.
 * The full build log is streamed to the build_jobs table.
 *
 * Routes:
 *   POST /api/sites/:id/builds              — trigger a build
 *   GET  /api/sites/:id/builds              — list build history
 *   GET  /api/sites/:id/builds/:buildId     — get build details + log
 *   DELETE /api/sites/:id/builds/:buildId   — cancel a queued build
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod/v4";
import { db, sitesTable, buildJobsTable, siteFilesTable, siteDeploymentsTable, siteEnvVarsTable } from "@workspace/db";
import { eq, and, desc, count } from "drizzle-orm";
import { asyncHandler, AppError } from "../lib/errors";
import { writeLimiter, deployLimiter } from "../middleware/rateLimiter";
import { storage } from "../lib/storageProvider";
import { emailDeploySuccess, emailDeployFailed } from "../lib/email";
import { invalidateSiteCache } from "../lib/domainCache";
import logger from "../lib/logger";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import os from "os";
import mime from "mime-types";
import crypto from "crypto";

const router: IRouter = Router();
const execFileAsync = promisify(execFile);

const BuildTriggerBody = z.object({
  gitUrl:         z.string().url().optional(),
  gitBranch:      z.string().default("main"),
  buildCommand:   z.string().max(500).default("npm run build"),
  outputDir:      z.string().max(200).default("dist"),
  environment:    z.enum(["production", "staging", "preview"]).default("production"),
  installCommand: z.string().max(500).optional(), // override auto-detected install
  envVars:        z.record(z.string(), z.string()).optional().default({}), // injected into build
});

// ── Build runner ──────────────────────────────────────────────────────────────

async function appendLog(buildId: number, text: string): Promise<void> {
  await db.execute(
    `UPDATE build_jobs SET log = COALESCE(log, '') || $1 WHERE id = $2`
      .replace("$1", `'${text.replace(/'/g, "''")}'`)
      .replace("$2", String(buildId))
  );
}

async function runBuild(buildId: number, siteId: number, opts: {
  gitUrl: string;
  gitBranch: string;
  buildCommand: string;
  outputDir: string;
  environment: string;
  installCommand?: string;
  envVars?: Record<string, string>;
  userId: string;
  userEmail?: string;
  siteName: string;
  siteDomain: string;
}): Promise<void> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fedhost-build-"));
  const log = (msg: string) => {
    process.stdout.write(msg + "\n");
    appendLog(buildId, msg + "\n").catch(() => {});
  };

  // Merge user-supplied env vars (safe — values are strings, no shell expansion)
  // Merge env vars: stored site vars → user-provided vars (user-provided take precedence)
  const storedVars = await db
    .select({ key: siteEnvVarsTable.key, value: siteEnvVarsTable.value })
    .from(siteEnvVarsTable)
    .where(eq(siteEnvVarsTable.siteId, siteId));

  const buildEnv: Record<string, string> = {
    ...process.env as Record<string, string>,
    NODE_ENV: "production",
    CI: "true",
    // Stored vars (lower priority)
    ...Object.fromEntries(storedVars.map(v => [v.key, v.value])),
    // User-provided vars override stored vars
    ...(opts.envVars ?? {}),
  };
  // Remove server secrets from build environment
  for (const key of ["SMTP_PASS", "DATABASE_URL", "REDIS_URL", "SESSION_SECRET",
                      "COOKIE_SECRET", "OBJECT_STORAGE_SECRET_ACCESS_KEY"]) {
    delete buildEnv[key];
  }

  try {
    await db.update(buildJobsTable).set({ status: "running", startedAt: new Date() }).where(eq(buildJobsTable.id, buildId));

    // ── Step 1: Clone ────────────────────────────────────────────────────────
    log(`[build] Cloning ${opts.gitUrl}@${opts.gitBranch}...`);
    await execFileAsync("git", ["clone", "--depth=1", "--branch", opts.gitBranch, opts.gitUrl, tmpDir], {
      timeout: 120_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    log("[build] Clone complete");

    // ── Step 2: Install ──────────────────────────────────────────────────────
    const hasYarnLock = fs.existsSync(path.join(tmpDir, "yarn.lock"));
    const hasPnpmLock = fs.existsSync(path.join(tmpDir, "pnpm-lock.yaml"));

    let installCmd: [string, string[]];
    if (opts.installCommand) {
      const [cmd, ...args] = opts.installCommand.split(" ");
      installCmd = [cmd!, args];
    } else if (hasPnpmLock) {
      installCmd = ["pnpm", ["install", "--frozen-lockfile"]];
    } else if (hasYarnLock) {
      installCmd = ["yarn", ["install", "--frozen-lockfile"]];
    } else {
      installCmd = ["npm", ["ci", "--prefer-offline"]];
    }

    log(`[build] Installing dependencies (${installCmd[0]})...`);
    await execFileAsync(installCmd[0], installCmd[1], {
      cwd: tmpDir, timeout: 300_000, env: buildEnv,
    });

    // ── Step 3: Build ────────────────────────────────────────────────────────
    const [cmd, ...args] = opts.buildCommand.split(" ");
    log(`[build] Running: ${opts.buildCommand}`);
    if (opts.envVars && Object.keys(opts.envVars).length > 0) {
      log(`[build] Injecting ${Object.keys(opts.envVars).length} env vars: ${Object.keys(opts.envVars).join(", ")}`);
    }
    const { stdout, stderr } = await execFileAsync(cmd!, args, {
      cwd: tmpDir, timeout: 600_000, env: buildEnv,
    });
    if (stdout) log(stdout);
    if (stderr) log(stderr);

    // ── Step 4: Upload output files ─────────────────────────────────────────
    const outDir = path.join(tmpDir, opts.outputDir);
    if (!fs.existsSync(outDir)) throw new Error(`Output directory '${opts.outputDir}' not found after build`);

    const allFiles = walkDir(outDir);
    log(`[build] Uploading ${allFiles.length} files...`);

    // Create deployment record
    const [site] = await db.select().from(sitesTable).where(eq(sitesTable.id, siteId));
    const [latestDep] = await db.select({ version: siteDeploymentsTable.version })
      .from(siteDeploymentsTable).where(eq(siteDeploymentsTable.siteId, siteId))
      .orderBy(desc(siteDeploymentsTable.version)).limit(1);
    const version = (latestDep?.version ?? 0) + 1;

    const deployment = await db.transaction(async (tx) => {
      // Mark existing active deployment
      await tx.update(siteDeploymentsTable)
        .set({ status: "failed" }) // temporarily mark as previous
        .where(and(eq(siteDeploymentsTable.siteId, siteId), eq(siteDeploymentsTable.status, "active")));

      const [dep] = await tx.insert(siteDeploymentsTable).values({
        siteId, version, deployedBy: `build:${buildId}`,
        environment: opts.environment, status: "pending",
        fileCount: allFiles.length, totalSizeMb: 0,
      }).returning();
      return dep;
    });

    // Upload files in parallel (concurrency = 8)
    log(`[build] Uploading ${allFiles.length} files in parallel...`);
    const CONCURRENCY = 8;
    let imported = 0;
    let totalBytes = 0;

    for (let i = 0; i < allFiles.length; i += CONCURRENCY) {
      const chunk = allFiles.slice(i, i + CONCURRENCY);
      await Promise.allSettled(chunk.map(async (relPath) => {
        const absPath = path.join(outDir, relPath);
        const stat    = fs.statSync(absPath);
        const ct      = (mime.lookup(relPath) || "application/octet-stream") as string;
        const hash    = crypto.createHash("sha256").update(fs.readFileSync(absPath)).digest("hex");

        const { uploadUrl, objectPath } = await storage.getUploadUrl({ contentType: ct, ttlSec: 900 });
        await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": ct }, body: fs.readFileSync(absPath) });

        await db.insert(siteFilesTable).values({
          siteId, filePath: relPath, objectPath, contentType: ct,
          sizeBytes: stat.size, contentHash: hash, deploymentId: deployment.id,
        });
        totalBytes += stat.size;
        imported++;
      }));
    }

    // Activate deployment
    await db.transaction(async (tx) => {
      await tx.update(siteDeploymentsTable)
        .set({ status: "active" })
        .where(eq(siteDeploymentsTable.id, deployment.id));
      await tx.update(sitesTable)
        .set({ storageUsedMb: totalBytes / (1024 * 1024) })
        .where(eq(sitesTable.id, siteId));
    });

    invalidateSiteCache(siteId);

    await db.update(buildJobsTable)
      .set({ status: "success", finishedAt: new Date() })
      .where(eq(buildJobsTable.id, buildId));

    log(`[build] ✓ Deployed ${allFiles.length} files (${(totalBytes / 1024 / 1024).toFixed(1)}MB) as v${version}`);

    if (opts.userEmail) {
      emailDeploySuccess({ to: opts.userEmail, siteName: opts.siteName, domain: opts.siteDomain, version, fileCount: allFiles.length, deployedAt: new Date().toUTCString() }).catch(() => {});
    }

  } catch (err: any) {
    log(`[build] ✗ Build failed: ${err.message}`);
    await db.update(buildJobsTable)
      .set({ status: "failed", finishedAt: new Date() })
      .where(eq(buildJobsTable.id, buildId));

    if (opts.userEmail) {
      emailDeployFailed({ to: opts.userEmail, siteName: opts.siteName, domain: opts.siteDomain, error: err.message }).catch(() => {});
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function walkDir(dir: string, base = dir): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(full, base));
    } else {
      results.push(path.relative(base, full));
    }
  }
  return results;
}

// ── Routes ────────────────────────────────────────────────────────────────────

router.post("/sites/:id/builds", deployLimiter, asyncHandler(async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();
  const siteId = parseInt(req.params.id as string, 10);
  if (isNaN(siteId)) throw AppError.badRequest("Invalid site ID");

  const [site] = await db.select().from(sitesTable).where(eq(sitesTable.id, siteId));
  if (!site) throw AppError.notFound("Site not found");
  if (site.ownerId !== req.user.id) throw AppError.forbidden();

  const parsed = BuildTriggerBody.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest(parsed.error.message);

  const gitUrl = parsed.data.gitUrl ?? (site as any).gitUrl;
  if (!gitUrl) throw AppError.badRequest("No Git URL configured for this site. Provide gitUrl in request body.", "NO_GIT_URL");

  // Check for already-running build
  const [running] = await db.select({ id: buildJobsTable.id }).from(buildJobsTable)
    .where(and(eq(buildJobsTable.siteId, siteId), eq(buildJobsTable.status, "running")));
  if (running) throw AppError.conflict("A build is already running for this site");

  const [job] = await db.insert(buildJobsTable).values({
    siteId, triggeredBy: req.user.id,
    gitUrl, gitBranch: parsed.data.gitBranch,
    buildCommand: parsed.data.buildCommand,
    outputDir: parsed.data.outputDir,
    status: "queued",
  }).returning();

  // Run build asynchronously — respond immediately
  res.status(202).json({ buildId: job.id, status: "queued", message: "Build started. Poll GET /api/sites/:id/builds/:buildId for status." });

  runBuild(job.id, siteId, {
    gitUrl, gitBranch: parsed.data.gitBranch,
    buildCommand: parsed.data.buildCommand,
    outputDir: parsed.data.outputDir,
    environment: parsed.data.environment,
    userId: req.user.id, userEmail: req.user.email,
    siteName: site.name, siteDomain: site.domain,
  }).catch(err => logger.error({ err, buildId: job.id }, "[build] Unhandled error"));
}));

router.get("/sites/:id/builds", asyncHandler(async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();
  const siteId = parseInt(req.params.id as string, 10);
  if (isNaN(siteId)) throw AppError.badRequest("Invalid site ID");

  const [site] = await db.select({ ownerId: sitesTable.ownerId }).from(sitesTable).where(eq(sitesTable.id, siteId));
  if (!site) throw AppError.notFound("Site not found");
  if (site.ownerId !== req.user.id) throw AppError.forbidden();

  const limit = Math.min(50, Math.max(1, parseInt((req.query.limit as string) || "20", 10)));
  const page  = Math.max(1, parseInt((req.query.page as string) || "1", 10));

  const [{ total }] = await db.select({ total: count() }).from(buildJobsTable).where(eq(buildJobsTable.siteId, siteId));
  const builds = await db.select().from(buildJobsTable)
    .where(eq(buildJobsTable.siteId, siteId))
    .orderBy(desc(buildJobsTable.createdAt))
    .limit(limit).offset((page - 1) * limit);

  // Strip log from list view for bandwidth
  res.json({ data: builds.map(b => ({ ...b, log: b.log ? `${b.log.length} chars` : null })), meta: { total: Number(total), page, limit } });
}));

router.get("/sites/:id/builds/:buildId", asyncHandler(async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();
  const siteId  = parseInt(req.params.id as string, 10);
  const buildId = parseInt(req.params.buildId as string, 10);
  if (isNaN(siteId) || isNaN(buildId)) throw AppError.badRequest("Invalid ID");

  const [site] = await db.select({ ownerId: sitesTable.ownerId }).from(sitesTable).where(eq(sitesTable.id, siteId));
  if (!site) throw AppError.notFound("Site not found");
  if (site.ownerId !== req.user.id) throw AppError.forbidden();

  const [build] = await db.select().from(buildJobsTable)
    .where(and(eq(buildJobsTable.id, buildId), eq(buildJobsTable.siteId, siteId)));
  if (!build) throw AppError.notFound("Build not found");

  res.json(build);
}));

router.delete("/sites/:id/builds/:buildId", writeLimiter, asyncHandler(async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();
  const siteId  = parseInt(req.params.id as string, 10);
  const buildId = parseInt(req.params.buildId as string, 10);
  if (isNaN(siteId) || isNaN(buildId)) throw AppError.badRequest("Invalid ID");

  const [site] = await db.select({ ownerId: sitesTable.ownerId }).from(sitesTable).where(eq(sitesTable.id, siteId));
  if (!site) throw AppError.notFound("Site not found");
  if (site.ownerId !== req.user.id) throw AppError.forbidden();

  await db.update(buildJobsTable)
    .set({ status: "cancelled", finishedAt: new Date() })
    .where(and(eq(buildJobsTable.id, buildId), eq(buildJobsTable.siteId, siteId), eq(buildJobsTable.status, "queued")));

  res.sendStatus(204);
}));

export default router;
