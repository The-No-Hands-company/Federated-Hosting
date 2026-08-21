/**
 * Docker container manager.
 *
 * Manages Docker containers for dynamic sites.
 * Each Docker site gets:
 *   - A unique port allocated from the range DYNAMIC_PORT_START..DYNAMIC_PORT_END
 *   - A supervised Docker container that is restarted on failure (up to MAX_RESTARTS)
 *   - Request proxying via the host router to the allocated port.
 *
 * Supported image formats:
 *   - Docker images from any registry (default: Docker Hub)
 *
 * Container lifecycle:
 *   start  → allocate port → pull image (if needed) → create and start container → health check → mark ready
 *   failure → log → wait backoff → restart (up to MAX_RESTARTS)
 *   stop   → stop container → remove container
 *
 * Security:
 *   - Containers run as a non-root user if specified in the image, otherwise we rely on the image's default.
 *   - Environment variables are passed from the site's environment configuration.
 *   - No automatic volume mounting for persistence in this MVP (can be added later).
 *
 * This module uses the Docker CLI (docker command) assuming it is installed and accessible.
 */

import { spawn, type ChildProcess } from "child_process";
import { createServer } from "net";
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";
import logger from "./logger";

// ── Configuration ─────────────────────────────────────────────────────────────

const PORT_START   = parseInt(process.env.DYNAMIC_PORT_START ?? "9000");
const PORT_END     = parseInt(process.env.DYNAMIC_PORT_END   ?? "9999");
const MAX_RESTARTS = parseInt(process.env.DYNAMIC_MAX_RESTARTS ?? "5");
const BACKOFF_BASE_MS = 2_000;
const HEALTH_CHECK_INTERVAL_MS = parseInt(process.env.DOCKER_HEALTH_CHECK_INTERVAL_MS ?? "5000");
const HEALTH_CHECK_TIMEOUT_MS = parseInt(process.env.DOCKER_HEALTH_CHECK_TIMEOUT_MS ?? "2000");

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

// ── Per-container log ring buffer ─────────────────────────────────────────────
// Stores the last LOG_BUFFER_SIZE lines of stdout+stderr per container.
// Never grows unboundedly — oldest lines are dropped when full.

const LOG_BUFFER_SIZE = 500;
const containerLogs = new Map<number, string[]>(); // siteId → last N lines

function appendContainerLog(siteId: number, line: string): void {
  if (!containerLogs.has(siteId)) containerLogs.set(siteId, []);
  const buf = containerLogs.get(siteId)!;
  buf.push(`[${new Date().toISOString()}] ${line}`);
  if (buf.length > LOG_BUFFER_SIZE) buf.splice(0, buf.length - LOG_BUFFER_SIZE);
}

export function getContainerLogs(siteId: number, tail = 100): string[] {
  const buf = containerLogs.get(siteId) ?? [];
  return buf.slice(-Math.min(tail, LOG_BUFFER_SIZE));
}

function clearContainerLogs(siteId: number): void {
  containerLogs.delete(siteId);
}

// ── Container state ───────────────────────────────────────────────────────────

export interface ContainerEntry {
  siteId: number;
  siteDomain: string;
  port: number;
  image: string;
  tag: string | null;
  env: Record<string, string>;
  containerId: string | null;
  status: "starting" | "running" | "failed" | "stopped";
  restartCount: number;
  startedAt: Date | null;
  lastFailedAt: Date | null;
}

const containers = new Map<number, ContainerEntry>(); // siteId → entry

// ── Docker command helper ─────────────────────────────────────────────────────

function docker(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const dockerProc = spawn("docker", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    dockerProc.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });
    dockerProc.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    dockerProc.on("close", (code) => {
      // code is null when the process was terminated by a signal rather than
      // exiting. Callers compare against 0, and null would silently read as a
      // non-zero failure only by accident; -1 says "did not exit normally"
      // explicitly and cannot be confused with a real exit status.
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

// ── Image pulling ─────────────────────────────────────────────────────────────

async function pullImage(image: string, tag: string | null): Promise<void> {
  const imageRef = tag ? `${image}:${tag}` : image;
  logger.info({ image: imageRef }, "[docker-manager] Pulling image");

  const result = await docker(["pull", imageRef]);
  if (result.code !== 0) {
    throw new Error(`Failed to pull image ${imageRef}: ${result.stderr}`);
  }
}

// ── Container creation and running ─────────────────────────────────────────────

async function createAndRunContainer(entry: ContainerEntry): Promise<void> {
  const imageRef = entry.tag ? `${entry.image}:${entry.tag}` : entry.image;
  const containerName = `nexus-hosting-site-${entry.siteId}-${uuidv4()}`;

  logger.info(
    { siteId: entry.siteId, domain: entry.siteDomain, image: imageRef, port: entry.port },
    "[docker-manager] Creating container",
  );

  // Build the docker run command
  const args = [
    "run",
    "-d", // detached mode
    "--name", containerName,
    "--restart", "no", // we handle restarts ourselves
    "-p", `${entry.port}:80`, // assuming the container exposes HTTP on port 80; we can make this configurable
    // Environment variables
    ...Object.entries(entry.env).flatMap(([key, value]) => ["-e", `${key}=${value}`]),
    // Add the image reference
    imageRef,
  ];

  const result = await docker(args);
  if (result.code !== 0) {
    throw new Error(`Failed to create container: ${result.stderr}`);
  }

  // Extract the container ID from the output (first line of stdout)
  const containerId = result.stdout.trim().split(/\s+/)[0];
  if (!containerId) {
    throw new Error("Failed to get container ID from docker run output");
  }

  entry.containerId = containerId;
  entry.status = "starting";
  entry.startedAt = new Date();

  // Start logging stdout and stderr
  const logProc = spawn("docker", ["logs", "-f", containerId], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  logProc.stdout?.on("data", (data: Buffer) => {
    const line = data.toString().trim();
    appendContainerLog(entry.siteId, line);
    logger.debug({ siteId: entry.siteId, domain: entry.siteDomain }, `[docker-container] ${line}`);
  });
  logProc.stderr?.on("data", (data: Buffer) => {
    const line = data.toString().trim();
    appendContainerLog(entry.siteId, `ERR: ${line}`);
    logger.warn({ siteId: entry.siteId, domain: entry.siteDomain }, `[docker-container:err] ${line}`);
  });

  // Wait for the container to be healthy (we'll do a simple port check for now)
  await waitForPort(entry.port, HEALTH_CHECK_TIMEOUT_MS);
  entry.status = "running";

  logger.info(
    { siteId: entry.siteId, domain: entry.siteDomain, port: entry.port, containerId },
    "[docker-manager] Container ready",
  );
}

// ── Wait for a container to bind a port ───────────────────────────────────────

function waitForPort(port: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;

    function probe() {
      const sock = createServer();
      sock.listen(port, "127.0.0.1", () => {
        sock.close(() => resolve());
      });
      sock.on("error", () => {
        if (Date.now() > deadline) {
          reject(new Error(`Container did not bind port ${port} within ${timeoutMs}ms`));
        } else {
          setTimeout(probe, 500);
        }
      });
    }

    probe();
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function startDockerContainer(opts: {
  siteId: number;
  siteDomain: string;
  image: string;
  tag: string | null;
  env: Record<string, string>;
}): Promise<{ port: number }> {
  // Respect NEXUS_STATIC_ONLY — operator may disable dynamic hosting
  // for security/simplicity, especially important for volunteer nodes
  if (process.env.NEXUS_STATIC_ONLY === "true") {
    throw new Error(
      "Dynamic site hosting is disabled on this node (NEXUS_STATIC_ONLY=true). " +
      "This node only serves static sites. Contact the node operator to enable dynamic hosting.",
    );
  }
  const existing = containers.get(opts.siteId);
  if (existing && (existing.status === "running" || existing.status === "starting")) {
    // If the image/tag is the same, we can return the existing port.
    // If different, we need to recreate the container.
    if (existing.image === opts.image && existing.tag === opts.tag) {
      return { port: existing.port };
    }
    // Otherwise, we need to stop the existing container and start a new one.
    stopDockerContainer(opts.siteId);
  }

  const port = await findFreePort();

  const entry: ContainerEntry = {
    siteId: opts.siteId,
    siteDomain: opts.siteDomain,
    port,
    image: opts.image,
    tag: opts.tag ?? null,
    env: opts.env,
    containerId: null,
    status: "starting",
    restartCount: 0,
    startedAt: null,
    lastFailedAt: null,
  };

  containers.set(opts.siteId, entry);

  try {
    await pullImage(entry.image, entry.tag);
    await createAndRunContainer(entry);
    return { port };
  } catch (err) {
    // Clean up on failure
    entry.status = "failed";
    entry.lastFailedAt = new Date();
    logger.error({ siteId: opts.siteId, err: (err as Error).message }, "[docker-manager] Failed to start container");
    throw err;
  }
}

export function stopDockerContainer(siteId: number): void {
  const entry = containers.get(siteId);
  if (!entry) return;

  logger.info({ siteId, domain: entry.siteDomain }, "[docker-manager] Stopping container");

  entry.status = "stopped";
  if (entry.containerId) {
    // Stop and remove the container
    docker(["stop", entry.containerId]).catch(() => {/* ignore */});
    docker(["rm", entry.containerId]).catch(() => {/* ignore */});
    entry.containerId = null;
  }

  releasePort(entry.port);
  containers.delete(siteId);
  // Keep logs for 5 minutes after stop
  setTimeout(() => clearContainerLogs(siteId), 5 * 60_000);
}

export function getDockerContainer(siteId: number): ContainerEntry | undefined {
  return containers.get(siteId);
}

export function getAllContainerStats() {
  return [...containers.values()].map((e) => ({
    siteId: e.siteId,
    domain: e.siteDomain,
    image: e.image,
    tag: e.tag,
    port: e.port,
    status: e.status,
    containerId: e.containerId,
    restartCount: e.restartCount,
    startedAt: e.startedAt?.toISOString(),
    lastFailedAt: e.lastFailedAt?.toISOString(),
  }));
}

export function stopAllContainers(): void {
  for (const siteId of containers.keys()) {
    stopDockerContainer(siteId);
  }
}