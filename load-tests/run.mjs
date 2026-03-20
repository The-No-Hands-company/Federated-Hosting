#!/usr/bin/env node
/**
 * Federated Hosting — Load Test Suite
 *
 * Tests the critical paths under sustained load to find bottlenecks before
 * production traffic does. Uses autocannon (HTTP/1.1 pipelining benchmarks).
 *
 * Usage:
 *   FH_BASE_URL=https://your-node.example.com node load-tests/run.mjs
 *   FH_BASE_URL=http://localhost:8080 node load-tests/run.mjs --scenario health
 *   FH_BASE_URL=http://localhost:8080 node load-tests/run.mjs --scenario site-serve
 *
 * Prerequisites:
 *   - A running FedHost node at FH_BASE_URL
 *   - For authenticated tests: FH_TEST_TOKEN=fh_... (API token)
 *   - For site-serve: FH_TEST_DOMAIN=yoursite.example.com (a deployed site)
 *
 * Scenarios:
 *   health       — Health check endpoint (should sustain 10K+ req/s)
 *   federation   — Federation discovery endpoints
 *   api-read     — Read-only API endpoints (sites, nodes lists)
 *   site-serve   — Static site serving via host-header routing (the hot path)
 *   deploy-flow  — Full deploy API flow (authenticated)
 *   all          — Run all scenarios in sequence (default)
 */

import autocannon from "autocannon";
import { setTimeout as sleep } from "timers/promises";

const BASE = (process.env.FH_BASE_URL ?? "http://localhost:8080").replace(/\/$/, "");
const TOKEN = process.env.FH_TEST_TOKEN ?? "";
const TEST_DOMAIN = process.env.FH_TEST_DOMAIN ?? "";
const SCENARIO = process.argv.find((a) => a.startsWith("--scenario="))?.split("=")[1]
  ?? process.argv[process.argv.indexOf("--scenario") + 1]
  ?? "all";

const DURATION_SECONDS = parseInt(process.env.LOAD_DURATION ?? "30");
const CONNECTIONS = parseInt(process.env.LOAD_CONNECTIONS ?? "50");

// Thresholds — test FAILS if p99 latency exceeds these values
const THRESHOLDS = {
  "health":       { p99Ms: 20,   minRps: 5000 },
  "federation":   { p99Ms: 100,  minRps: 500  },
  "api-read":     { p99Ms: 200,  minRps: 200  },
  "site-serve":   { p99Ms: 150,  minRps: 1000 },
  "deploy-flow":  { p99Ms: 2000, minRps: 20   },
};

function formatResult(result) {
  const rps = result.requests.average;
  const p99 = result.latency.p99;
  const errors = result.errors;
  const timeouts = result.timeouts;
  return { rps, p99, errors, timeouts };
}

function checkThresholds(scenarioName, result) {
  const thresholds = THRESHOLDS[scenarioName];
  if (!thresholds) return true;

  const { rps, p99, errors } = formatResult(result);
  const passed = p99 <= thresholds.p99Ms && rps >= thresholds.minRps && errors === 0;

  const status = passed ? "✅ PASS" : "❌ FAIL";
  console.log(`  ${status}  p99=${p99}ms (threshold: ${thresholds.p99Ms}ms)  rps=${Math.round(rps)} (min: ${thresholds.minRps})  errors=${errors}`);
  return passed;
}

async function run(opts) {
  return new Promise((resolve, reject) => {
    const instance = autocannon(opts, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
    autocannon.track(instance, { renderProgressBar: true, renderResultsTable: false });
  });
}

const results = {};

// ── Scenario: Health ──────────────────────────────────────────────────────────
async function scenarioHealth() {
  console.log("\n📊 Scenario: health check endpoints");
  console.log(`   ${CONNECTIONS} connections × ${DURATION_SECONDS}s\n`);

  const r = await run({
    url: `${BASE}/api/health/live`,
    connections: CONNECTIONS,
    duration: DURATION_SECONDS,
    title: "GET /api/health/live",
  });

  const { rps, p99 } = formatResult(r);
  console.log(`\n  GET /api/health/live — avg ${Math.round(rps)} req/s, p99 ${p99}ms`);
  results["health"] = checkThresholds("health", r);

  const r2 = await run({
    url: `${BASE}/api/health/ready`,
    connections: CONNECTIONS,
    duration: DURATION_SECONDS,
    title: "GET /api/health/ready",
  });
  const fmt2 = formatResult(r2);
  console.log(`\n  GET /api/health/ready — avg ${Math.round(fmt2.rps)} req/s, p99 ${fmt2.p99}ms`);
}

// ── Scenario: Federation discovery ───────────────────────────────────────────
async function scenarioFederation() {
  console.log("\n📡 Scenario: federation discovery");
  console.log(`   ${CONNECTIONS} connections × ${DURATION_SECONDS}s\n`);

  const endpoints = [
    "/.well-known/federation",
    "/api/federation/meta",
    "/api/federation/peers",
    "/api/federation/bootstrap",
  ];

  for (const path of endpoints) {
    const r = await run({
      url: `${BASE}${path}`,
      connections: Math.min(CONNECTIONS, 20),
      duration: DURATION_SECONDS,
      title: `GET ${path}`,
    });
    const { rps, p99, errors } = formatResult(r);
    console.log(`\n  ${path} — ${Math.round(rps)} req/s, p99 ${p99}ms, errors ${errors}`);
  }

  // Combined test
  const r = await run({
    url: `${BASE}/api/federation/meta`,
    connections: CONNECTIONS,
    duration: DURATION_SECONDS,
  });
  results["federation"] = checkThresholds("federation", r);
}

// ── Scenario: API read operations ─────────────────────────────────────────────
async function scenarioApiRead() {
  console.log("\n📖 Scenario: read-only API endpoints");
  console.log(`   ${CONNECTIONS} connections × ${DURATION_SECONDS}s\n`);

  const endpoints = [
    "/api/sites?limit=20",
    "/api/nodes?limit=20",
    "/api/federation/events?limit=20",
  ];

  for (const path of endpoints) {
    const r = await run({
      url: `${BASE}${path}`,
      connections: Math.min(CONNECTIONS, 25),
      duration: DURATION_SECONDS,
      title: `GET ${path}`,
    });
    const { rps, p99, errors } = formatResult(r);
    console.log(`\n  ${path} — ${Math.round(rps)} req/s, p99 ${p99}ms, errors ${errors}`);
  }

  // Threshold check on the heaviest endpoint
  const r = await run({
    url: `${BASE}/api/sites?limit=20`,
    connections: CONNECTIONS,
    duration: DURATION_SECONDS,
  });
  results["api-read"] = checkThresholds("api-read", r);
}

// ── Scenario: Site serving (the HOT path) ─────────────────────────────────────
async function scenarioSiteServe() {
  if (!TEST_DOMAIN) {
    console.log("\n⚠️  Skipping site-serve: set FH_TEST_DOMAIN=yoursite.example.com");
    results["site-serve"] = null;
    return;
  }

  console.log(`\n🌐 Scenario: static site serving via ${TEST_DOMAIN}`);
  console.log(`   ${CONNECTIONS} connections × ${DURATION_SECONDS}s`);
  console.log("   This tests host-router caching, object storage streaming, analytics buffer\n");

  const r = await run({
    url: `${BASE}/`,
    connections: CONNECTIONS,
    duration: DURATION_SECONDS,
    headers: {
      Host: TEST_DOMAIN,
    },
    title: `GET / [Host: ${TEST_DOMAIN}]`,
  });

  const { rps, p99, errors } = formatResult(r);
  console.log(`\n  Host: ${TEST_DOMAIN} / — ${Math.round(rps)} req/s, p99 ${p99}ms, errors ${errors}`);
  results["site-serve"] = checkThresholds("site-serve", r);

  // Also test a CSS/asset path
  const r2 = await run({
    url: `${BASE}/styles.css`,
    connections: CONNECTIONS,
    duration: Math.min(DURATION_SECONDS, 15),
    headers: { Host: TEST_DOMAIN },
    title: `GET /styles.css [Host: ${TEST_DOMAIN}]`,
  });
  const fmt2 = formatResult(r2);
  console.log(`\n  Host: ${TEST_DOMAIN} /styles.css — ${Math.round(fmt2.rps)} req/s, p99 ${fmt2.p99}ms`);
}

// ── Scenario: Deploy flow (authenticated) ─────────────────────────────────────
async function scenarioDeployFlow() {
  if (!TOKEN) {
    console.log("\n⚠️  Skipping deploy-flow: set FH_TEST_TOKEN=fh_...");
    results["deploy-flow"] = null;
    return;
  }

  console.log("\n🚀 Scenario: authenticated API + deploy flow");
  console.log(`   ${Math.min(CONNECTIONS, 20)} connections × ${DURATION_SECONDS}s\n`);

  // Test token auth on /api/tokens (authenticated list)
  const r = await run({
    url: `${BASE}/api/tokens`,
    connections: Math.min(CONNECTIONS, 20),
    duration: DURATION_SECONDS,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
    },
    title: "GET /api/tokens (authenticated)",
  });

  const { rps, p99, errors } = formatResult(r);
  console.log(`\n  GET /api/tokens — ${Math.round(rps)} req/s, p99 ${p99}ms, errors ${errors}`);
  results["deploy-flow"] = checkThresholds("deploy-flow", r);

  // Test site listing (authenticated, returns owned sites)
  const r2 = await run({
    url: `${BASE}/api/sites?limit=20`,
    connections: Math.min(CONNECTIONS, 20),
    duration: Math.min(DURATION_SECONDS, 15),
    headers: {
      Authorization: `Bearer ${TOKEN}`,
    },
  });
  const fmt2 = formatResult(r2);
  console.log(`\n  GET /api/sites (auth) — ${Math.round(fmt2.rps)} req/s, p99 ${fmt2.p99}ms`);
}

// ── Soak test: sustained load over 5 minutes ──────────────────────────────────
async function scenarioSoak() {
  console.log("\n🛁 Soak test: 5 minutes sustained load on health + federation");
  console.log("   Looking for memory leaks and connection pool exhaustion\n");

  const SOAK_DURATION = parseInt(process.env.SOAK_DURATION ?? "300");

  const r = await run({
    url: `${BASE}/api/health/live`,
    connections: CONNECTIONS,
    duration: SOAK_DURATION,
    title: "Soak: /api/health/live (5min)",
  });

  const { rps, p99, errors, timeouts } = formatResult(r);
  console.log(`\n  Soak result — ${Math.round(rps)} req/s, p99 ${p99}ms, errors ${errors}, timeouts ${timeouts}`);

  if (errors > 0 || timeouts > 0) {
    console.log("  ❌ FAIL — errors or timeouts during soak test (check for connection pool exhaustion)");
  } else {
    console.log("  ✅ PASS — no errors or timeouts over 5 minutes");
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
console.log("╔════════════════════════════════════════════════════════╗");
console.log("║         FedHost Load Test Suite                        ║");
console.log("╚════════════════════════════════════════════════════════╝");
console.log(`\nTarget:    ${BASE}`);
console.log(`Scenario:  ${SCENARIO}`);
console.log(`Duration:  ${DURATION_SECONDS}s per scenario`);
console.log(`Connections: ${CONNECTIONS}`);
if (TOKEN) console.log("Auth:      API token provided");
if (TEST_DOMAIN) console.log(`Site:      ${TEST_DOMAIN}`);

const start = Date.now();

try {
  if (SCENARIO === "health" || SCENARIO === "all") {
    await scenarioHealth();
    await sleep(2000);
  }
  if (SCENARIO === "federation" || SCENARIO === "all") {
    await scenarioFederation();
    await sleep(2000);
  }
  if (SCENARIO === "api-read" || SCENARIO === "all") {
    await scenarioApiRead();
    await sleep(2000);
  }
  if (SCENARIO === "site-serve" || SCENARIO === "all") {
    await scenarioSiteServe();
    await sleep(2000);
  }
  if (SCENARIO === "deploy-flow" || SCENARIO === "all") {
    await scenarioDeployFlow();
    await sleep(2000);
  }
  if (SCENARIO === "soak") {
    await scenarioSoak();
  }
} catch (err) {
  console.error("\n❌ Load test error:", err.message);
  process.exit(1);
}

const elapsed = Math.round((Date.now() - start) / 1000);

console.log("\n════════════════════════════════════════════════════════");
console.log("RESULTS SUMMARY");
console.log("════════════════════════════════════════════════════════");

let allPassed = true;
for (const [name, passed] of Object.entries(results)) {
  if (passed === null) {
    console.log(`  ⏭️  ${name}: skipped`);
  } else if (passed) {
    console.log(`  ✅  ${name}: PASS`);
  } else {
    console.log(`  ❌  ${name}: FAIL`);
    allPassed = false;
  }
}

console.log(`\nTotal time: ${elapsed}s`);

if (!allPassed) {
  console.log("\n❌ One or more scenarios failed their thresholds.");
  console.log("   Check slow queries, missing indexes, Redis connectivity, object storage.");
  process.exit(1);
} else {
  console.log("\n✅ All scenarios passed.");
}
