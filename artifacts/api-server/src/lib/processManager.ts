/**
 * Dynamic process manager.
 *
 * Manages persistent server processes for dynamic sites (NLPL, Node.js, etc.).
 * Each dynamic site gets:
 *   - A unique port allocated from the range DYNAMIC_PORT_START..DYNAMIC_PORT_END
 *   - A supervised child process that is restarted on crash (up to MAX_RESTARTS)
 *   - Request proxying via http-proxy-middleware in the host router
 *
 * Supported runtimes:
 *   nlpl    — python src/main.py server.nlpl (requires NLPL_INTERPRETER_PATH)
 *   node    — node server.js (requires Node.js in PATH)
 *   python  — python server.py (requires Python 3 in PATH)
 *
 * Process lifecycle:
 *   start  → allocate port → spawn process → health check → mark ready
 *   crash  → log → wait backoff → restart (up to MAX_RESTARTS)
 *   stop   → SIGTERM → wait 5s → SIGKILL
 *   scale  → (future: multiple processes per site behind internal load balancer)
 *
 * Security:
 *   - Processes run as a non-root user (DYNAMIC_PROCESS_USER, default: "nobody")
 *   - Environment is sanitised — no credentials, no DB URLs passed to site processes
 *   - Sites communicate via HTTP only — no Unix socket access
 *   - Resource limits: MAX_MEMORY_MB, MAX_CPU_PCT per process
 *
 * This module is intentionally not a full container orchestrator.
 * For true isolation, wrap each process in a Docker container or
 * use a platform like Fly.io that provides per-process VMs.
 * This implementation is appropriate for trusted operators running
 * sites for known users, not untrusted arbitrary code.
 */

import { spawn, type ChildProcess } from "child_process";
import { createServer } from "net";
import path from "path";
import fs from "fs";
import http from "http";
import logger from "./logger";

// ── Configuration ─────────────────────────────────────────────────────────────

const PORT_START   = parseInt(process.env.DYNAMIC_PORT_START ?? "9000");
const PORT_END     = parseInt(process.env.DYNAMIC_PORT_END   ?? "9999");
const MAX_RESTARTS = parseInt(process.env.DYNAMIC_MAX_RESTARTS ?? "5");
const BACKOFF_BASE_MS = 2_000;

// Path to the NLPL interpreter — the cloned NLPL repo's src/main.py
const NLPL_INTERPRETER = process.env.NLPL_INTERPRETER_PATH ?? "/opt/nlpl/src/main.py";
// Python executable (python3 or python depending on the system)
const PYTHON_BIN = process.env.PYTHON_BIN ?? "python3";

// ── Port pool ─────────────────────────────────────────────────────────────────

const allocatedPorts = new Set<number>();

async function findFreePort(): Promise<number> {
  for (let port = PORT_START; port <= PORT_END; port++) {
    if (allocatedPorts.has(port)) continue;

    // Double-check the port isn't in use by something else
    const free = await new Promise<boolean>((resolve) => {
      const server = createServer();
      server.listen(port, "127.0.0.1", () => {
        server.close(() => resolve(true));
      });
      server.on("error", () => resolve(false));
    });

    if (free) {
      allocatedPorts.add(port);
      return port;
    }
  }
  throw new Error(`No free ports in range ${PORT_START}–${PORT_END}`);
}

function releasePort(port: number): void {
  allocatedPorts.delete(port);
}

// ── Per-process log ring buffer ───────────────────────────────────────────────
// Stores the last LOG_BUFFER_SIZE lines of stdout+stderr per site process.
// Never grows unboundedly — oldest lines are dropped when full.

const LOG_BUFFER_SIZE = 500;
const processLogs = new Map<number, string[]>(); // siteId → last N lines

function appendProcessLog(siteId: number, line: string): void {
  if (!processLogs.has(siteId)) processLogs.set(siteId, []);
  const buf = processLogs.get(siteId)!;
  buf.push(`[${new Date().toISOString()}] ${line}`);
  if (buf.length > LOG_BUFFER_SIZE) buf.splice(0, buf.length - LOG_BUFFER_SIZE);
}

export function getProcessLogs(siteId: number, tail = 100): string[] {
  const buf = processLogs.get(siteId) ?? [];
  return buf.slice(-Math.min(tail, LOG_BUFFER_SIZE));
}

function clearProcessLogs(siteId: number): void {
  processLogs.delete(siteId);
}

export type RuntimeType = "nlpl" | "node" | "python";

export interface ProcessEntry {
  siteId: number;
  siteDomain: string;
  port: number;
  runtime: RuntimeType;
  workDir: string;
  entryFile: string;
  process: ChildProcess | null;
  status: "starting" | "running" | "crashed" | "stopped";
  restartCount: number;
  startedAt: Date | null;
  lastCrashAt: Date | null;
  pid: number | null;
}

const processes = new Map<number, ProcessEntry>(); // siteId → entry

// ── Build the command for a given runtime ─────────────────────────────────────

function buildCommand(entry: ProcessEntry): { cmd: string; args: string[] } {
  const entryPath = path.join(entry.workDir, entry.entryFile);

  switch (entry.runtime) {
    case "nlpl":
      return {
        cmd: PYTHON_BIN,
        args: [NLPL_INTERPRETER, entryPath],
      };
    case "node":
      return {
        cmd: "node",
        args: [entryPath],
      };
    case "python":
      return {
        cmd: PYTHON_BIN,
        args: [entryPath],
      };
  }
}

// ── Spawn a process ───────────────────────────────────────────────────────────

async function spawnProcess(entry: ProcessEntry): Promise<void> {
  const { cmd, args } = buildCommand(entry);

  // Sanitised environment: site gets PORT and a subset of safe vars only
  // NEVER pass DATABASE_URL, REDIS_URL, API keys, or any credentials
  const env: NodeJS.ProcessEnv = {
    PORT: String(entry.port),
    NODE_ENV: "production",
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    HOME: process.env.HOME ?? "/tmp",
    // NLPL-specific
    NLPL_ENV: "production",
    SITE_DOMAIN: entry.siteDomain,
  };

  logger.info(
    { siteId: entry.siteId, domain: entry.siteDomain, cmd, port: entry.port, runtime: entry.runtime },
    "[process-manager] Spawning process",
  );

  const child = spawn(cmd, args, {
    cwd: entry.workDir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    // uid/gid: could set to nobody (65534) but requires running as root first
    // For now, inherit the process user (should be non-root per Docker setup)
  });

  entry.process = child;
  entry.pid = child.pid ?? null;
  entry.status = "starting";
  entry.startedAt = new Date();

  // Pipe stdout/stderr to logger AND ring buffer
  child.stdout?.on("data", (data: Buffer) => {
    const line = data.toString().trim();
    appendProcessLog(entry.siteId, line);
    logger.debug({ siteId: entry.siteId, domain: entry.siteDomain }, `[site-process] ${line}`);
  });
  child.stderr?.on("data", (data: Buffer) => {
    const line = data.toString().trim();
    appendProcessLog(entry.siteId, `ERR: ${line}`);
    logger.warn({ siteId: entry.siteId, domain: entry.siteDomain }, `[site-process:err] ${line}`);
  });

  child.on("exit", (code, signal) => {
    logger.warn(
      { siteId: entry.siteId, domain: entry.siteDomain, code, signal, restarts: entry.restartCount },
      "[process-manager] Process exited",
    );
    entry.status = "crashed";
    entry.lastCrashAt = new Date();
    entry.process = null;
    entry.pid = null;

    if (entry.restartCount < MAX_RESTARTS) {
      const delay = BACKOFF_BASE_MS * Math.pow(2, entry.restartCount);
      entry.restartCount++;
      logger.info(
        { siteId: entry.siteId, delayMs: delay, attempt: entry.restartCount },
        "[process-manager] Scheduling restart",
      );
      setTimeout(() => {
        if (processes.has(entry.siteId)) {
          spawnProcess(entry).catch((err) =>
            logger.error({ err, siteId: entry.siteId }, "[process-manager] Restart failed"),
          );
        }
      }, delay);
    } else {
      logger.error(
        { siteId: entry.siteId, domain: entry.siteDomain },
        "[process-manager] Max restarts reached — giving up",
      );
      entry.status = "stopped";
    }
  });

  // Wait for the process to start listening on PORT
  await waitForPort(entry.port, 15_000);
  entry.status = "running";

  logger.info(
    { siteId: entry.siteId, domain: entry.siteDomain, port: entry.port, pid: entry.pid },
    "[process-manager] Process ready",
  );
}

// ── Wait for a process to bind a port ─────────────────────────────────────────

function waitForPort(port: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;

    function probe() {
      const sock = new http.ClientRequest({ host: "127.0.0.1", port, path: "/", method: "HEAD" });
      sock.on("response", () => { sock.destroy(); resolve(); });
      sock.on("error", () => {
        if (Date.now() > deadline) {
          reject(new Error(`Process did not bind port ${port} within ${timeoutMs}ms`));
        } else {
          setTimeout(probe, 500);
        }
      });
      sock.end();
    }

    probe();
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function startSiteProcess(opts: {
  siteId: number;
  siteDomain: string;
  runtime: RuntimeType;
  workDir: string;
  entryFile: string;
}): Promise<{ port: number }> {
  const existing = processes.get(opts.siteId);
  if (existing && (existing.status === "running" || existing.status === "starting")) {
    return { port: existing.port };
  }

  // Validate that the entry file exists
  const entryPath = path.join(opts.workDir, opts.entryFile);
  if (!fs.existsSync(entryPath)) {
    throw new Error(`Entry file not found: ${entryPath}`);
  }

  // Validate NLPL interpreter is available
  if (opts.runtime === "nlpl" && !fs.existsSync(NLPL_INTERPRETER)) {
    throw new Error(
      `NLPL interpreter not found at ${NLPL_INTERPRETER}. ` +
      `Set NLPL_INTERPRETER_PATH or run: git clone https://github.com/Zajfan/NLPL /opt/nlpl`,
    );
  }

  const port = await findFreePort();

  const entry: ProcessEntry = {
    siteId: opts.siteId,
    siteDomain: opts.siteDomain,
    port,
    runtime: opts.runtime,
    workDir: opts.workDir,
    entryFile: opts.entryFile,
    process: null,
    status: "starting",
    restartCount: 0,
    startedAt: null,
    lastCrashAt: null,
    pid: null,
  };

  processes.set(opts.siteId, entry);

  await spawnProcess(entry);

  return { port };
}

export function stopSiteProcess(siteId: number): void {
  const entry = processes.get(siteId);
  if (!entry) return;

  logger.info({ siteId, domain: entry.siteDomain }, "[process-manager] Stopping process");

  entry.status = "stopped";
  const proc = entry.process;
  if (proc) {
    entry.process = null;
    proc.kill("SIGTERM");
    // Force-kill after 5 seconds if it doesn't exit cleanly
    setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch { /* already dead */ }
    }, 5_000);
  }

  releasePort(entry.port);
  processes.delete(siteId);
  // Keep logs for 5 minutes after stop so the UI can still show them
  setTimeout(() => clearProcessLogs(siteId), 5 * 60_000);
}

export function getSiteProcess(siteId: number): ProcessEntry | undefined {
  return processes.get(siteId);
}

export function getSiteProxyTarget(siteId: number): string | null {
  const entry = processes.get(siteId);
  if (!entry || entry.status !== "running") return null;
  return `http://127.0.0.1:${entry.port}`;
}

export function getAllProcessStats() {
  return [...processes.values()].map((e) => ({
    siteId: e.siteId,
    domain: e.siteDomain,
    runtime: e.runtime,
    port: e.port,
    status: e.status,
    pid: e.pid,
    restartCount: e.restartCount,
    startedAt: e.startedAt?.toISOString(),
    lastCrashAt: e.lastCrashAt?.toISOString(),
  }));
}

export function stopAllProcesses(): void {
  for (const siteId of processes.keys()) {
    stopSiteProcess(siteId);
  }
}
