/**
 * NLPL runtime routes.
 *
 * Handles deploying and managing NLPL web applications on the platform.
 *
 * NLPL sites differ from static sites:
 *   - They have a persistent server process (python src/main.py server.nlpl)
 *   - The process listens on a PORT env var and handles HTTP requests
 *   - Files are stored in object storage AND extracted to a local workDir
 *   - The host router proxies requests to the process instead of serving files
 *
 * A minimal NLPL web server looks like:
 *
 *   import network
 *   import io
 *
 *   function handle_request with request returns String
 *     return "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\nHello from NLPL!"
 *   end
 *
 *   call network.serve_http with handle_request, PORT
 *
 * Routes:
 *   POST /api/sites/:id/nlpl/start      — start or restart the NLPL process
 *   POST /api/sites/:id/nlpl/stop       — stop the NLPL process
 *   GET  /api/sites/:id/nlpl/status     — process status, port, restart count
 *   GET  /api/nlpl/runtime-info         — NLPL interpreter version + availability
 *   GET  /api/admin/processes           — all running dynamic processes (admin only)
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod/v4";
import { db, sitesTable, siteFilesTable, siteDeploymentsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { asyncHandler, AppError } from "../lib/errors";
import { writeLimiter } from "../middleware/rateLimiter";
import { requireAdmin } from "../middleware/requireAdmin";
import {
  startSiteProcess,
  stopSiteProcess,
  getSiteProcess,
  getAllProcessStats,
  getProcessLogs,
  type RuntimeType,
} from "../lib/processManager";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";
import os from "os";
import logger from "../lib/logger";
import { storage } from "../lib/storageProvider";

const router: IRouter = Router();
const execFileAsync = promisify(execFile);

const PYTHON_BIN = process.env.PYTHON_BIN ?? "python3";
const NLPL_INTERPRETER = process.env.NLPL_INTERPRETER_PATH ?? "/opt/nlpl/src/main.py";

// ── GET /api/nlpl/runtime-info ─────────────────────────────────────────────────

router.get("/nlpl/runtime-info", asyncHandler(async (req: Request, res: Response) => {
  const interpreterExists = fs.existsSync(NLPL_INTERPRETER);

  let nlplVersion: string | null = null;
  let pythonVersion: string | null = null;

  try {
    const { stdout } = await execFileAsync(PYTHON_BIN, ["--version"], { timeout: 5000 });
    pythonVersion = stdout.trim() || "unknown";
  } catch {
    pythonVersion = null;
  }

  if (interpreterExists) {
    try {
      const { stdout } = await execFileAsync(PYTHON_BIN, [NLPL_INTERPRETER, "--version"], { timeout: 5000 });
      nlplVersion = stdout.trim() || "unknown";
    } catch {
      nlplVersion = "installed (version check failed)";
    }
  }

  res.json({
    available: interpreterExists && pythonVersion !== null,
    interpreterPath: NLPL_INTERPRETER,
    interpreterExists,
    nlplVersion,
    pythonVersion,
    pythonBin: PYTHON_BIN,
    portRange: {
      start: parseInt(process.env.DYNAMIC_PORT_START ?? "9000"),
      end: parseInt(process.env.DYNAMIC_PORT_END ?? "9999"),
    },
    installInstructions: interpreterExists
      ? null
      : "git clone https://github.com/Zajfan/NLPL /opt/nlpl",
  });
}));

// ── POST /api/sites/:id/nlpl/start ─────────────────────────────────────────────

router.post(
  "/sites/:id/nlpl/start",
  writeLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.isAuthenticated()) throw AppError.unauthorized();

    const siteId = parseInt(req.params.id as string, 10);
    if (Number.isNaN(siteId)) throw AppError.badRequest("Invalid site ID");

    const [site] = await db
      .select()
      .from(sitesTable)
      .where(eq(sitesTable.id, siteId));

    if (!site) throw AppError.notFound("Site not found");
    if (site.ownerId !== req.user.id) throw AppError.forbidden("Only the site owner can manage processes");

    const { entryFile = "server.nlpl" } = z.object({
      entryFile: z.string().max(200).default("server.nlpl"),
    }).parse(req.body);

    // Determine runtime from site type
    const runtime: RuntimeType =
      site.siteType === "nlpl" ? "nlpl" :
      site.siteType === "dynamic" || site.siteType === "other" ? "node" :
      "nlpl";

    // Find the active deployment's files and extract them to a work directory
    const [activeDep] = await db
      .select()
      .from(siteDeploymentsTable)
      .where(and(eq(siteDeploymentsTable.siteId, siteId), eq(siteDeploymentsTable.status, "active")))
      .orderBy(desc(siteDeploymentsTable.id))
      .limit(1);

    if (!activeDep) {
      throw AppError.badRequest("No active deployment found. Deploy your NLPL files first.");
    }

    // Extract site files to a local temp directory so the NLPL interpreter can access them
    const workDir = path.join(os.tmpdir(), `nlpl-site-${siteId}`);
    fs.mkdirSync(workDir, { recursive: true });

    const files = await db
      .select()
      .from(siteFilesTable)
      .where(eq(siteFilesTable.siteId, siteId));

    logger.info({ siteId, fileCount: files.length, workDir }, "[nlpl] Extracting site files");

    for (const file of files) {
      try {
        // Download file from object storage to local workDir
        const downloadUrl = await storage.getDownloadUrl(file.objectPath, 300);
        const response = await fetch(downloadUrl, { signal: AbortSignal.timeout(30_000) });
        if (!response.ok) {
          logger.warn({ siteId, filePath: file.filePath }, "[nlpl] Failed to download file");
          continue;
        }
        const fileDest = path.join(workDir, file.filePath);
        fs.mkdirSync(path.dirname(fileDest), { recursive: true });
        const buffer = Buffer.from(await response.arrayBuffer());
        fs.writeFileSync(fileDest, buffer);
      } catch (err) {
        logger.warn({ siteId, filePath: file.filePath, err }, "[nlpl] File extraction error");
      }
    }

    // Verify the entry file was extracted
    const entryPath = path.join(workDir, entryFile);
    if (!fs.existsSync(entryPath)) {
      const available = fs.readdirSync(workDir).filter((f) => f.endsWith(".nlpl") || f.endsWith(".js") || f.endsWith(".py"));
      throw AppError.badRequest(
        `Entry file '${entryFile}' not found in deployment. ` +
        `Available files: ${available.join(", ") || "none"}. ` +
        `Make sure you've uploaded a '${entryFile}' file.`,
      );
    }

    // Start the process
    const { port } = await startSiteProcess({
      siteId,
      siteDomain: site.domain,
      runtime,
      workDir,
      entryFile,
    });

    logger.info({ siteId, domain: site.domain, port, runtime }, "[nlpl] Process started");

    res.json({
      status: "running",
      siteId,
      domain: site.domain,
      port,
      runtime,
      entryFile,
      workDir,
      message: `${runtime.toUpperCase()} process started on port ${port}. Your site is now live.`,
    });
  }),
);

// ── POST /api/sites/:id/nlpl/stop ──────────────────────────────────────────────

router.post(
  "/sites/:id/nlpl/stop",
  writeLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.isAuthenticated()) throw AppError.unauthorized();

    const siteId = parseInt(req.params.id as string, 10);
    if (Number.isNaN(siteId)) throw AppError.badRequest("Invalid site ID");

    const [site] = await db.select({ id: sitesTable.id, ownerId: sitesTable.ownerId }).from(sitesTable).where(eq(sitesTable.id, siteId));
    if (!site) throw AppError.notFound("Site not found");
    if (site.ownerId !== req.user.id) throw AppError.forbidden();

    stopSiteProcess(siteId);

    res.json({ status: "stopped", siteId, message: "Process stopped." });
  }),
);

// ── GET /api/sites/:id/nlpl/status ─────────────────────────────────────────────

router.get(
  "/sites/:id/nlpl/status",
  asyncHandler(async (req: Request, res: Response) => {
    const siteId = parseInt(req.params.id as string, 10);
    if (Number.isNaN(siteId)) throw AppError.badRequest("Invalid site ID");

    const entry = getSiteProcess(siteId);

    if (!entry) {
      res.json({ status: "stopped", siteId, port: null, runtime: null });
      return;
    }

    res.json({
      status: entry.status,
      siteId,
      domain: entry.siteDomain,
      port: entry.port,
      pid: entry.pid,
      runtime: entry.runtime,
      restartCount: entry.restartCount,
      startedAt: entry.startedAt?.toISOString(),
      lastCrashAt: entry.lastCrashAt?.toISOString(),
    });
  }),
);

// ── GET /api/sites/:id/nlpl/logs ───────────────────────────────────────────────
// Returns the tail of the process's recent stdout/stderr.
// The processManager captures output in a ring buffer per process.

router.get(
  "/sites/:id/nlpl/logs",
  asyncHandler(async (req: Request, res: Response) => {
    const siteId = parseInt(req.params.id as string, 10);
    if (Number.isNaN(siteId)) throw AppError.badRequest("Invalid site ID");

    const tail = Math.min(parseInt((req.query.tail as string) ?? "100", 10), 500);
    const lines = getProcessLogs(siteId, tail);

    res.json({ siteId, lines, count: lines.length });
  }),
);

// ── GET /api/admin/processes — all running processes ──────────────────────────

router.get(
  "/admin/processes",
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    res.json({
      processes: getAllProcessStats(),
      total: getAllProcessStats().length,
    });
  }),
);

export default router;
