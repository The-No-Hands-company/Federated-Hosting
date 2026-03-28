# Load Tests

Benchmarks for the Nexus Hosting API under sustained load.

## Prerequisites

```bash
npm install -g autocannon
```

## Quick start

```bash
# Against local dev server
NH_BASE_URL=http://localhost:8080 node load-tests/run.mjs

# Against a live node
NH_BASE_URL=https://your-node.example.com node load-tests/run.mjs

# Single scenario
NH_BASE_URL=http://localhost:8080 node load-tests/run.mjs --scenario health

# With auth + site serving
NH_BASE_URL=http://localhost:8080 \
  NH_TEST_TOKEN=fh_your_token \
  NH_TEST_DOMAIN=yoursite.example.com \
  node load-tests/run.mjs

# 5-minute soak test (memory leaks, pool exhaustion)
NH_BASE_URL=http://localhost:8080 node load-tests/run.mjs --scenario soak
```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `NH_BASE_URL` | `http://localhost:8080` | Node URL to test against |
| `NH_TEST_TOKEN` | — | API token for authenticated scenarios |
| `NH_TEST_DOMAIN` | — | Domain of a deployed site for site-serve scenario |
| `LOAD_DURATION` | `30` | Seconds per scenario |
| `LOAD_CONNECTIONS` | `50` | Concurrent connections |
| `SOAK_DURATION` | `300` | Soak test duration in seconds |

## Scenarios

| Scenario | What it tests | p99 threshold | Min req/s |
|---|---|---|---|
| `health` | `/api/health/live` liveness probe | 20ms | 5,000 |
| `federation` | Discovery, peers, bootstrap endpoints | 100ms | 500 |
| `api-read` | Sites, nodes, events list endpoints | 200ms | 200 |
| `site-serve` | Host-header routing + object storage + analytics | 150ms | 1,000 |
| `deploy-flow` | Authenticated API (token auth, sites list) | 2,000ms | 20 |
| `soak` | 5-minute sustained load — checks for leaks | No errors | — |

## Interpreting results

**p99 latency above threshold** → Likely cause: slow database query, missing index, or object storage latency. Run `EXPLAIN ANALYZE` on the query identified in slow logs.

**req/s below threshold** → Likely cause: CPU-bound processing, connection pool exhaustion, or rate limiting hitting. Check `DB_POOL_MAX`, Redis connectivity, and CPU usage.

**Errors > 0** → Never acceptable. Check logs for 5xx responses. Common causes: connection pool exhausted, object storage errors, uncaught exceptions.

**Timeouts > 0 in soak test** → Memory leak or connection leak. Check for uncleaned setTimeout/setInterval, DB connections not released, or growing analytics buffer.

## Expected production numbers

On a 2 vCPU / 2 GB RAM node with PostgreSQL on the same host:

| Scenario | Expected p99 | Expected req/s |
|---|---|---|
| health | < 5ms | 10,000+ |
| federation | < 50ms | 1,000+ |
| api-read | < 100ms | 500+ |
| site-serve (warm cache) | < 30ms | 3,000+ |
| site-serve (cold cache) | < 200ms | 500+ |

With Redis for the LRU domain cache (shared across instances) and a CDN layer in front, site-serve throughput should scale linearly with CDN edge nodes.

## CI integration

Add to `.github/workflows/ci.yml` for nightly load tests:

```yaml
- name: Load test (health only)
  run: |
    npm install -g autocannon
    LOAD_DURATION=10 LOAD_CONNECTIONS=20 \
      NH_BASE_URL=${{ secrets.FH_NODE_URL }} \
      node load-tests/run.mjs --scenario health
```
