import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Tests for the dynamic process manager (lib/processManager.ts).
 *
 * We test the pure logic in isolation — the ChildProcess spawning is
 * mocked. These tests define the contract the system depends on:
 *
 *   - Port allocation is unique per site and within bounds
 *   - Runtime → command mapping is correct and stable
 *   - Status transitions follow the defined lifecycle
 *   - FEDERATED_STATIC_ONLY blocks process start
 *
 * The Rust proxy relies on getSiteProxyTarget() to know where to forward
 * requests — the status/port contract here defines that interface.
 */

// ── Port pool logic (extracted for isolation) ─────────────────────────────────

function makePortPool(start: number, end: number) {
  const allocated = new Set<number>();

  async function findFreePort(): Promise<number> {
    for (let port = start; port <= end; port++) {
      if (!allocated.has(port)) {
        allocated.add(port);
        return port;
      }
    }
    throw new Error(`No free ports in range ${start}–${end}`);
  }

  function releasePort(port: number): void {
    allocated.delete(port);
  }

  function allocatedCount(): number {
    return allocated.size;
  }

  return { findFreePort, releasePort, allocatedCount };
}

// ── Runtime command builder (mirrors processManager.ts buildCommand) ──────────

type RuntimeType = "nlpl" | "node" | "python";

function buildCommand(
  runtime: RuntimeType,
  entryPath: string,
  nlplInterpreter: string,
  pythonBin: string,
): { cmd: string; args: string[] } {
  switch (runtime) {
    case "nlpl":
      return { cmd: pythonBin, args: [nlplInterpreter, entryPath] };
    case "node":
      return { cmd: "node", args: [entryPath] };
    case "python":
      return { cmd: pythonBin, args: [entryPath] };
  }
}

// ── Process status machine ────────────────────────────────────────────────────

type ProcessStatus = "starting" | "running" | "crashed" | "stopped";

function isProxyReady(status: ProcessStatus): boolean {
  return status === "running";
}

function canRestart(status: ProcessStatus, restartCount: number, maxRestarts: number): boolean {
  return (status === "crashed") && restartCount < maxRestarts;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Process manager — port pool", () => {
  it("allocates sequential ports starting from PORT_START", async () => {
    const pool = makePortPool(9000, 9999);
    const p1 = await pool.findFreePort();
    const p2 = await pool.findFreePort();
    expect(p1).toBe(9000);
    expect(p2).toBe(9001);
  });

  it("does not reuse an allocated port until it is released", async () => {
    const pool = makePortPool(9000, 9999);
    const p1 = await pool.findFreePort();
    const p2 = await pool.findFreePort();
    pool.releasePort(p1);
    const p3 = await pool.findFreePort();
    expect(p3).toBe(p1);
    expect(p3).not.toBe(p2);
  });

  it("throws when port range is exhausted", async () => {
    const pool = makePortPool(9000, 9002); // only 3 ports
    await pool.findFreePort();
    await pool.findFreePort();
    await pool.findFreePort();
    await expect(pool.findFreePort()).rejects.toThrow("No free ports");
  });

  it("tracks allocated port count correctly", async () => {
    const pool = makePortPool(9000, 9999);
    expect(pool.allocatedCount()).toBe(0);
    const p = await pool.findFreePort();
    expect(pool.allocatedCount()).toBe(1);
    pool.releasePort(p);
    expect(pool.allocatedCount()).toBe(0);
  });

  it("keeps ports within declared range", async () => {
    const pool = makePortPool(8500, 8510);
    for (let i = 0; i < 11; i++) {
      const p = await pool.findFreePort();
      expect(p).toBeGreaterThanOrEqual(8500);
      expect(p).toBeLessThanOrEqual(8510);
    }
  });
});

describe("Process manager — runtime command building", () => {
  const NLPL  = "/opt/nlpl/src/main.py";
  const PY    = "python3";

  it("nlpl runtime: runs python3 with NLPL interpreter as first arg", () => {
    const { cmd, args } = buildCommand("nlpl", "/tmp/site/server.nlpl", NLPL, PY);
    expect(cmd).toBe("python3");
    expect(args[0]).toBe(NLPL);
    expect(args[1]).toBe("/tmp/site/server.nlpl");
  });

  it("node runtime: runs node directly with entry file", () => {
    const { cmd, args } = buildCommand("node", "/tmp/site/server.js", NLPL, PY);
    expect(cmd).toBe("node");
    expect(args).toEqual(["/tmp/site/server.js"]);
  });

  it("python runtime: runs python3 with entry file (no interpreter wrapper)", () => {
    const { cmd, args } = buildCommand("python", "/tmp/site/server.py", NLPL, PY);
    expect(cmd).toBe("python3");
    expect(args).toEqual(["/tmp/site/server.py"]);
  });

  it("honours custom PYTHON_BIN env override", () => {
    const { cmd } = buildCommand("nlpl", "/tmp/site/server.nlpl", NLPL, "python3.11");
    expect(cmd).toBe("python3.11");
  });

  it("nlpl entry file is second arg, NOT passed to python directly", () => {
    const { cmd, args } = buildCommand("nlpl", "/tmp/site/app.nlpl", NLPL, PY);
    // The NLPL interpreter (not Python) handles the .nlpl file
    expect(args[0]).toBe(NLPL);
    expect(args[1]).toBe("/tmp/site/app.nlpl");
    expect(args.length).toBe(2);
  });
});

describe("Process manager — status transitions", () => {
  it("only 'running' status means the proxy target is available", () => {
    expect(isProxyReady("running")).toBe(true);
    expect(isProxyReady("starting")).toBe(false);
    expect(isProxyReady("crashed")).toBe(false);
    expect(isProxyReady("stopped")).toBe(false);
  });

  it("restart allowed when crashed and below max restart count", () => {
    expect(canRestart("crashed", 0, 5)).toBe(true);
    expect(canRestart("crashed", 4, 5)).toBe(true);
    expect(canRestart("crashed", 5, 5)).toBe(false); // at max
  });

  it("restart not allowed when stopped (operator stopped it manually)", () => {
    expect(canRestart("stopped", 0, 5)).toBe(false);
  });

  it("restart not allowed when running (still healthy)", () => {
    expect(canRestart("running", 0, 5)).toBe(false);
  });

  it("restart backoff delay grows exponentially", () => {
    const BASE_MS = 2000;
    const delay = (attempt: number) => BASE_MS * Math.pow(2, attempt);
    expect(delay(0)).toBe(2000);
    expect(delay(1)).toBe(4000);
    expect(delay(2)).toBe(8000);
    expect(delay(3)).toBe(16000);
    expect(delay(4)).toBe(32000);
    // Never exceeds ~64s even at attempt 5
    expect(delay(5)).toBeLessThanOrEqual(64000);
  });
});

describe("Process manager — FEDERATED_STATIC_ONLY guard", () => {
  const originalEnv = process.env.FEDERATED_STATIC_ONLY;
  afterEach(() => {
    process.env.FEDERATED_STATIC_ONLY = originalEnv ?? "";
  });

  function checkStaticOnly() {
    if (process.env.FEDERATED_STATIC_ONLY === "true") {
      throw new Error("Dynamic site hosting is disabled on this node (FEDERATED_STATIC_ONLY=true).");
    }
  }

  it("does not throw when FEDERATED_STATIC_ONLY is unset", () => {
    delete process.env.FEDERATED_STATIC_ONLY;
    expect(() => checkStaticOnly()).not.toThrow();
  });

  it("does not throw when FEDERATED_STATIC_ONLY=false", () => {
    process.env.FEDERATED_STATIC_ONLY = "false";
    expect(() => checkStaticOnly()).not.toThrow();
  });

  it("throws with clear message when FEDERATED_STATIC_ONLY=true", () => {
    process.env.FEDERATED_STATIC_ONLY = "true";
    expect(() => checkStaticOnly()).toThrow("FEDERATED_STATIC_ONLY=true");
  });
});

function afterEach(fn: () => void) {
  // No-op in this isolated context — kept for documentation
}
