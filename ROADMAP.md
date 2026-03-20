# Federated Hosting — Roadmap

A living document tracking what is built, what is in progress, and what must be completed before real production traffic.

**Read `docs/HONEST_ASSESSMENT.md` before using this roadmap.** Many items previously marked ✅ are working in development but have known production gaps.

---

## Legend

- ✅ Functional and tested
- ⚠️ Implemented but has known production gap (see HONEST_ASSESSMENT.md)
- 🔨 In active development
- 📋 Planned
- ❌ Documented/claimed but not actually implemented
- 🔮 Future

---

## Phase 1 — Foundation

| Feature | Status | Notes |
|---|---|---|
| PostgreSQL schema + Drizzle ORM | ✅ | Good schema, correct indexes |
| Replit Auth (OIDC) | ✅ | Browser flows work |
| Ed25519 key pair generation + signing | ✅ | Correct implementation |
| `/.well-known/federation` discovery | ✅ | |
| Federation handshake + ping | ✅ | 5-minute timestamp window enforced |
| Node health monitor | ✅ | N=3 consecutive failures required, exponential backoff |
| Object storage (file upload/download) | ✅ | S3StorageProvider + ReplitStorageProvider, env-var selected |
| Site file serving (host-header routing) | ✅ | LRU cache (10K domains, 50K files), invalidated on deploy |
| Capacity tracking | ✅ | |
| Rate limiting | ✅ | Redis-backed when REDIS_URL set; warns in prod if missing |
| Structured logging + error handling | ✅ | Pino, AppError, stack traces redacted in prod |
| Graceful shutdown | ✅ | |
| DB connection pool | ✅ | Explicit max/min/timeout config, error handler |
| Database migrations | ✅ | 0000_initial_schema.sql + migrate.ts runner |

---

## Phase 2 — User Product

| Feature | Status | Notes |
|---|---|---|
| Dashboard (stats, chart) | ✅ | |
| Federation Nodes + Sites pages | ✅ | |
| My Sites (auth, inline register) | ✅ | |
| Deploy page (upload, preview, rollback) | ✅ | |
| Site preview modal (iframe sandbox) | ✅ | |
| Federation Protocol page | ✅ | |
| Onboarding flow | ✅ | |
| Node Marketplace | ✅ | |
| API Reference page | ✅ | |
| Bahasa Indonesia i18n | ✅ | HTTP backend (i18next-http-backend), loaded on demand from /locales/ |
| React lazy loading | ✅ | All 14 routes code-split |

---

## Phase 3 — Access Control + Custom Domains

| Feature | Status | Notes |
|---|---|---|
| API tokens (Bearer auth) | ✅ | SHA-256 hashed |
| Site team members (owner/editor/viewer) | ✅ | |
| Site visibility (public/private) | ✅ | |
| Password-protected sites | ✅ | HMAC-signed cookie, timingSafeEqual verified |
| Custom domain CNAME+TXT verification | ✅ | |
| Custom domain routing in host router | ✅ | Subject to caching gap above |

---

## Phase 4 — Federation Replication

| Feature | Status | Notes |
|---|---|---|
| Site sync push (notify peers on deploy) | ✅ | Ed25519 signed |
| Federation manifest endpoint | ✅ | Presigned URLs valid 1 hour |
| Site sync pull (file replication) | ✅ | Retry queue with exponential backoff (30s→2m→10m→1h→6h), max 10 attempts |
| Gossip-based peer discovery | ⚠️ | Works; gossip peer list is in-memory per instance |
| Same-domain conflict resolution | ✅ | First-write-wins + pubkey tiebreaker |
| Bootstrap node registry | ✅ | |

---

## Phase 5 — Analytics + Admin

| Feature | Status | Notes |
|---|---|---|
| Analytics buffer → hourly rollup | ✅ | Uses inArray() — correct and safe |
| Per-site analytics page | ✅ | |
| Network-wide analytics | ✅ | |
| Node operator admin dashboard | ✅ | requireAdmin middleware, isAdmin DB flag + ADMIN_USER_IDS env var |
| Admin node settings | ✅ | requireAdmin enforced |
| Webhook notifications (Ed25519 signed) | ✅ | |

---

## Phase 6 — CLI + Infrastructure

| Feature | Status | Notes |
|---|---|---|
| `fh` CLI (init, deploy, rollback, status, analytics, sites, tokens) | ✅ | Works against running node |
| `@fedhost/cli` npm package | ⚠️ | Package structured correctly, not published |
| GitHub Actions deploy workflow | ✅ | |
| GitHub Actions CI (typecheck, lint, build) | ✅ | |
| GitHub Actions npm publish workflow | ✅ | Needs `NPM_TOKEN` secret |
| Docker Compose | ✅ | Redis + MinIO + S3StorageProvider wired, REDIS_URL passed to app |
| Dockerfile (multi-stage) | ✅ | |

---

## Phase 7 — TLS + Geographic Routing

| Feature | Status | Notes |
|---|---|---|
| ACME/Let's Encrypt automation | ✅ | Real acme-client: account key, HTTP-01 challenge, cert written to disk, 12h auto-renewal |
| TLS via Caddy (documented) | ✅ | Caddy instruction accurate |
| Geographic routing (closest-node redirect) | ✅ | Region inference + 302 redirect |
| Geo routing: latency probing | ❌ | Mentioned in code comment, not implemented |

---

## Production Gaps Remaining

| # | Issue | Severity | Status |
|---|---|---|---|
| 1 | S3/MinIO object storage | CRITICAL | ✅ Fixed — S3StorageProvider, AWS SDK v3 |
| 2 | Drizzle migrations | CRITICAL | ✅ Fixed — 0000_initial_schema.sql + migrate.ts |
| 3 | Redis rate limiting | CRITICAL | ✅ Fixed — shared Redis store, falls back with warning |
| 4 | Unlock cookie security | HIGH | ✅ Fixed — HMAC-signed, timingSafeEqual |
| 5 | Admin RBAC | HIGH | ✅ Fixed — requireAdmin middleware, isAdmin flag |
| 6 | Host router LRU cache | HIGH | ✅ Fixed — 10K domain + 50K file entries |
| 7 | DB pool configuration | MEDIUM | ✅ Fixed — max/min/timeout/error handler |
| 8 | Session expiry cleanup | MEDIUM | ✅ Fixed — 6-hour background job |
| 9 | Analytics bulk delete | MEDIUM | ✅ Fixed — uses inArray() |
| 10 | Health monitor threshold | MEDIUM | ✅ Fixed — N=3 consecutive failures |
| 11 | Replay attack window | MEDIUM | ✅ Fixed — 5-minute timestamp check |
| 12 | i18n async loading | LOW | ✅ Fixed — i18next-http-backend, HTTP-fetched |
| 13 | Federation sync retry | MEDIUM | ✅ Fixed — exponential backoff queue, 10 max attempts |
| 14 | ACME TLS automation | MEDIUM | ✅ Full acme-client implementation |
| 15 | Admin audit logging | MEDIUM | ✅ auditLog(), admin_audit_log table, GET /api/admin/audit-log |
| 16 | Content deduplication | LOW | ✅ content_hash column, dedup on register-file, objectPath reuse |
| 17 | Prometheus metrics | LOW | ✅ prom-client, 12 metrics, GET /metrics, metricsMiddleware |
| 18 | Gossip in-memory per-instance | LOW | ⚠️ Multi-instance gossip not Redis-shared |
| 19 | Session store (multi-instance) | MEDIUM | ✅ Redis-first with PostgreSQL fallback; cross-instance session sharing |

---

## Scaling Checklist (Pre-10K Users)

- [ ] Redis deployed and all stores configured
- [ ] Object storage working with S3/MinIO
- [ ] Migrations committed and tested
- [ ] Host router LRU cache in place
- [ ] Load test: 100 req/s sustained for 1 hour — measure p99 latency
- [ ] Database query analysis: `EXPLAIN ANALYZE` all hot paths
- [ ] CDN in front of reverse proxy
- [ ] Horizontal scaling tested (2+ API server instances)
- [ ] Federation sync reliability test: simulate node downtime + recovery

---

## Future Work

| Feature | Status | Notes |
|---|---|---|
| Paid plans / node sponsorship | 🔮 | Revenue model not designed |
| Prometheus metrics + Grafana dashboards | 🔮 | |
| OpenTelemetry distributed tracing | 🔮 | |
| Virtual scrolling for large lists | 🔮 | |
| CDN integration guide | 🔮 | |
| Multi-region PostgreSQL (read replicas) | 🔮 | |
| Content deduplication (file hash) | 🔮 | |

---

*Last updated: March 2026. This document is intentionally critical — see `docs/HONEST_ASSESSMENT.md`.*
