# Nexus Hosting — Roadmap

A living document tracking what is built, what remains, and what the honest gaps are before real production traffic.

---

## Legend

- ✅ Functional and tested
- ⚠️ Works but has a known production gap
- 🔨 In active development
- 📋 Planned
- ❌ Not built
- 🔮 Future / nice to have

---

## Phase 1 — Foundation

| Feature | Status | Notes |
|---|---|---|
| PostgreSQL schema + Drizzle ORM | ✅ | 25+ tables, correct indexes |
| Database migrations | ✅ | `0000_initial_schema.sql` + `migrate.ts` runner |
| OIDC auth (OpenID Connect + PKCE) | ✅ | Browser + API token flows |
| Ed25519 key pair + signing | ✅ | Correct implementation |
| `/.well-known/federation` discovery | ✅ | |
| Federation handshake + ping | ✅ | 5-minute replay attack window |
| Node health monitor | ✅ | N=3 consecutive failures, exponential backoff |
| Object storage (S3/MinIO/R2/B2) | ✅ | `S3StorageProvider` (AWS SDK v3) + `ReplitStorageProvider` |
| Site file serving (host-header routing) | ✅ | LRU cache: 10K domains, 50K files, 5-min TTL |
| Rate limiting | ✅ | Redis-backed; 7 limiters; warns if Redis absent |
| Structured logging + error handling | ✅ | Pino, AppError, no stack traces in prod |
| Graceful shutdown | ✅ | SIGTERM/SIGINT handled |
| DB connection pool | ✅ | Explicit max/min/timeout/error handler |

---

## Phase 2 — User Product

| Feature | Status | Notes |
|---|---|---|
| Dashboard (stats, chart) | ✅ | |
| My Sites (deploy, rollback, clone, transfer, export) | ✅ | |
| Deploy page (upload, preview, rollback, diff) | ✅ | |
| Site preview modal | ✅ | iframe sandbox |
| Deployment diff (visual inline panel) | ✅ | +/~/- file counts, net size delta |
| Onboarding flow | ✅ | localStorage-dismissed modal |
| Bahasa Indonesia i18n | ✅ | `i18next-http-backend`, lazy-loaded from /locales/ |
| React lazy loading | ✅ | All routes code-split |
| Email verification | ✅ | SHA-256 tokens, 24h TTL, resend banner in dashboard |
| Per-user storage cap | ✅ | Operator-set cap per user (default: unlimited). NexusHosting is always free. |
| User suspension | ✅ | Operators can suspend abusive users without deleting data |
| Abuse report button | ✅ | On every site card; 8 reason categories |

---

## Phase 3 — Access Control + Custom Domains

| Feature | Status | Notes |
|---|---|---|
| API tokens (Bearer auth) | ✅ | SHA-256 hashed, scoped (read/write/deploy) |
| Site team members (owner/editor/viewer) | ✅ | |
| Invitation system | ✅ | Email invites, 7-day tokens, accept flow |
| Site visibility (public/private/password) | ✅ | HMAC-signed cookie, timingSafeEqual verification |
| Custom domain CNAME+TXT verification | ✅ | |
| SPA routing toggle | ✅ | Per-site flag, drives Rust proxy index.html fallback |
| IP ban system | ✅ | API + site scope, 60s in-memory cache, admin CRUD |

---

## Phase 4 — Federation Replication

| Feature | Status | Notes |
|---|---|---|
| Site sync push (notify peers on deploy) | ✅ | Ed25519 signed |
| Federation manifest endpoint | ✅ | Presigned S3 URLs, 1h validity |
| Site sync pull (file replication) | ✅ | Retry queue: 30s→2m→10m→1h→6h, max 10 attempts |
| Gossip-based peer discovery | ✅ | DB-backed, multi-instance safe |
| Same-domain conflict resolution | ✅ | First-write-wins + pubkey tiebreaker |
| Bootstrap node registry | ✅ | Returns active verified peers |
| Federation replay attack window | ✅ | 5-minute timestamp enforcement |
| Node trust scoring | ✅ | `node_trust` table; unverified→verified→trusted at 50 pings |
| Federation blocklist (defederation) | ✅ | Full CRUD, enforced in gossip/ping/sync |
| Federation for dynamic sites | ❌ | NLPL/Node process state not replicated |
| Canonical external seed nodes | ❌ | Bootstrap only returns nodes in your own DB |

---

## Phase 5 — Analytics + Admin

| Feature | Status | Notes |
|---|---|---|
| Analytics buffer → hourly rollup | ✅ | `inArray()` safe, 6h retention cleanup |
| Per-site analytics page | ✅ | |
| Network-wide analytics | ✅ | |
| SSE real-time analytics | ✅ | EventSource, live hit counter |
| Node operator admin dashboard | ✅ | `requireAdmin` middleware, `isAdmin` DB flag + `ADMIN_USER_IDS` env |
| Admin moderation panel | ✅ | Abuse report review/takedown, IP ban management UI |
| Admin audit logging | ✅ | `admin_audit_log` table, GET /api/admin/audit-log |
| Prometheus metrics | ✅ | `prom-client`, 13 metrics, `/metrics` endpoint |
| Grafana dashboards | ✅ | node-overview, federation-health, site-traffic |
| Webhook notifications | ✅ | Ed25519 signed, delivery log, 5-attempt retry queue |
| Form submission backend | ✅ | POST /forms/:domain/:name, spam scoring, CSV export |
| Full-text site search | ✅ | tsvector GIN index, Postgres trigger |

---

## Phase 6 — CLI + Infrastructure

| Feature | Status | Notes |
|---|---|---|
| `fh` CLI core (deploy, rollback, status, sites, tokens) | ✅ | |
| `nh domains` | ✅ | list/add/verify/delete/tls-status |
| `nh teams` | ✅ | list/invite/role/remove/revoke |
| `nh create --type` | ✅ | HTML/React/Vue/Next/Svelte + nlpl/node/python dynamic |
| `nh env`, `nh forms`, `nh logs`, `nh watch` | ✅ | |
| `@nexushosting/cli` npm package | ⚠️ | Structured correctly; not published to npm |
| GitHub Actions deploy workflow | ✅ | |
| Docker Compose | ✅ | Redis + MinIO + Caddy + Rust proxy wired |
| Dockerfile (multi-stage, non-root) | ✅ | |
| Rust proxy (`crates/nexus-proxy`) | ✅ | All 9 TODOs done: streaming, LRU, Redis invalidation, geo, metrics, Brotli |

---

## Phase 7 — TLS + Geographic Routing

| Feature | Status | Notes |
|---|---|---|
| ACME/Let's Encrypt automation | ✅ | HTTP-01 + DNS-01, 12h renewal, expiry email |
| TLS via Caddy | ✅ | Documented; Caddyfile dual-routing (TS + Rust proxy) |
| Geographic routing (closest-node redirect) | ✅ | Region scoring, 40+ country mappings |

---

## Phase 8 — Build Pipeline

| Feature | Status | Notes |
|---|---|---|
| Git clone → install → build → deploy | ✅ | |
| Git webhook auto-deploy | ✅ | GitHub/GitLab HMAC verification |
| Build log streaming | ✅ | SSE, visible in dashboard |
| Build cache | ✅ | Lockfile SHA-256 → skip install on hit; `BUILD_CACHE_DIR` configurable |
| Preview deployments | ✅ | Non-main branches → `{branch}--{domain}`; `isPreview` + `previewDomain` in response |
| Build environment injection | ✅ | Per-site env vars injected at build time |
| NLPL / Node.js / Python dynamic sites | ✅ | Process manager, port pool, health checks |

---

## Remaining Gaps (Honest — March 2026)

### Category 1 — Core Platform

| Gap | Severity | Status |
|---|---|---|
| Billing / payment processing | N/A | NexusHosting is free. Donations only. No tiers, no Stripe. |
| Email verification enforced on deploys | MEDIUM | ⚠️ Email sent on login; unverified users can still deploy |
| Malware scanning on upload | HIGH | ❌ No ClamAV hook or content scanning |
| CDN integration | LOW | ❌ Not built |

### Category 2 — Federation Maturity

| Gap | Severity | Status |
|---|---|---|
| Canonical external seed node list | HIGH | ❌ A fresh node has no peers to start from |
| Dynamic site federation | MEDIUM | ❌ NLPL/Node state/env/DB not replicated |
| Node trust score in federation UI | LOW | ⚠️ DB table exists; not surfaced in frontend |

### Category 3 — Security

| Gap | Severity | Status |
|---|---|---|
| CIDR-range IP bans in middleware | MEDIUM | ⚠️ Schema supports it; only exact IP checked |
| Rust proxy per-domain rate limiting shared | MEDIUM | ⚠️ In-memory per-proxy-instance only |

### Category 4 — Operator Experience

| Gap | Severity | Status |
|---|---|---|
| Upgrade runbook | HIGH | ❌ Not written |
| Incident response runbook | MEDIUM | ❌ Not written |
| `@nexushosting/cli` published to npm | LOW | ❌ Not published |

---

## Scaling Checklist (Pre-10K Users)

- [ ] Redis deployed and `REDIS_URL` configured
- [ ] Object storage verified (S3/R2/MinIO bucket accessible)
- [ ] Migrations applied on production DB
- [ ] Load test: 100 req/s sustained 1 hour, p99 < 150ms
- [ ] `EXPLAIN ANALYZE` on hot DB paths
- [ ] CDN in front of Caddy
- [ ] 2+ API server instances verified (session sharing via Redis)
- [ ] Federation sync reliability test: node downtime + recovery
- [ ] Email delivery tested end-to-end
- [ ] Abuse report flow tested end-to-end (submit → admin review → takedown)
- [ ] Build cache dir (`BUILD_CACHE_DIR`) on a persistent volume

---

## Future Work

| Feature | Notes |
|---|---|
| Donation / sponsorship link | Optional — NexusHosting is free; donations welcome but never required |
| Malware scanning (ClamAV) | Hook on upload, async scan, takedown on detection |
| Canonical public seed node registry | Well-known URL any new node can bootstrap from |
| Dynamic site federation | Replicate NLPL process config + env (not state) |
| CIDR-range IP bans | Extend middleware to check subnets |
| Published `@nexushosting/cli` | `npm publish` with `NPM_TOKEN` secret |
| OpenTelemetry tracing | Distributed traces across TS + Rust |
| Multi-region PostgreSQL | Read replicas for analytics queries |
| Virtual scrolling for large lists | Admin lists paginated today |

---

*Last updated: March 2026. Cross-reference `docs/HONEST_ASSESSMENT.md` before deploying.*
