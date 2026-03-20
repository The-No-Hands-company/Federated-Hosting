# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

### Added
- MIT License file
- `README.md` — project overview, quick start, feature summary, API table
- `CONTRIBUTING.md` — development setup, code style, PR checklist
- `SECURITY.md` — vulnerability disclosure policy, security model
- `ARCHITECTURE.md` — system design, data flow, schema reference, technology choices
- `API.md` — full REST API reference with request/response examples
- `FEDERATION_PROTOCOL.md` — complete specification for the `fedhost/1.0` protocol
- `DEPLOYMENT.md` — production setup guide, nginx config, scaling notes, federation joining

---

## [0.3.0] — Phase 4: Production Hardening

### Added
- **Helmet** — CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy headers on every response
- **Rate limiting** — global 200 req/min; 20 req/min on auth and upload endpoints; 50 req/min on federation endpoints
- **Gzip compression** — all responses compressed via `compression`
- **Structured logging** — pino JSON logger with request IDs; pino-http request/response logging; `privateKey` and `password` fields auto-redacted
- **X-Request-ID** — every request gets a UUID; echoed in response header for tracing
- **AppError class** — typed error class with `statusCode`, `code`, `isOperational`; used throughout all route handlers
- **asyncHandler** — wraps async route handlers so thrown errors propagate to the global error handler; eliminates try/catch boilerplate
- **Global error handler** — structured JSON error responses; no stack traces in production
- **404 handler** — clean JSON response for unmatched routes
- **Pagination** — all list endpoints (`GET /nodes`, `GET /sites`, `GET /federation/peers`, `GET /federation/events`) now accept `?page=&limit=` and return `{ data, meta }`
- **DB transaction on deploy** — deployment creation, file assignment, and site update are wrapped in a single atomic transaction
- **DB indexes** — added indexes on `sites.ownerId`, `sites.status`, `sites.primaryNodeId`, `nodes.status`, `nodes.isLocalNode`, `site_deployments.siteId`, `site_deployments.status`, `site_files.siteId`, `site_files.(siteId, filePath)`, `site_files.deploymentId`, `federation_events.eventType`, `federation_events.fromNodeDomain`, `federation_events.createdAt`
- **File path sanitisation** — `path.normalize` + strip leading `..` on all file paths to prevent directory traversal
- **File size limits** — 50 MB per-file, 500 MB per-deployment enforced server-side
- **Allowed content types whitelist** — rejects uploads with non-whitelisted MIME types
- **Graceful shutdown** — `SIGTERM`/`SIGINT` drains in-flight requests and closes DB pool cleanly
- **unhandledRejection / uncaughtException handlers** — logs and exits cleanly on unrecoverable errors
- **ErrorBoundary component** — React error boundary wrapping all routes; shows friendly fallback UI with "Try Again" button
- **QueryCache / MutationCache error handlers** — auto-redirect to `/api/login` on 401; exponential retry backoff; no retries on 4xx errors
- **Health endpoints** — `/api/health` (full), `/api/health/live` (liveness), `/api/health/ready` (readiness)
- **Auth rate limiting** — `/api/login` now protected by auth rate limiter (20 req/min)
- **pino-pretty** dev dependency — pretty-printed logs in development

### Changed
- `siteDeploymentsTable` — added `createdAt` column alongside `deployedAt`
- Deploy route now uses `count()` query inside transaction instead of a separate pre-transaction query
- Federation ping now signs `${nodeDomain}:${challenge}:${timestamp}` (timestamp added to message)
- `GET /api/healthz` renamed to `GET /api/health` with expanded response body

---

## [0.2.0] — Phase 3: Subdomain Routing + Replication

### Added
- **Host-header routing middleware** (`middleware/hostRouter.ts`) — any request whose `Host` matches a registered site domain is served directly, without going through `/api/sites/serve`
- **Replication on deploy** — deploy endpoint iterates all active peer nodes and sends signed `site_sync` notifications via `X-Federation-Signature`
- **Node capacity API** — `GET /api/capacity/summary` (network overview), `GET /api/nodes/:id/capacity` (per-node storage stats), `POST /api/nodes/:id/update-capacity`
- **Auto-init local node** — `ensureLocalNode()` in `index.ts` creates a local node record with Ed25519 keys on every boot if none exists
- **SPA fallback** — host-header site server falls back to `index.html` if the requested path is not found (supports single-page apps)

---

## [0.1.0] — Phase 2: Federation Protocol

### Added
- **Ed25519 key pairs** — `crypto.generateKeyPairSync("ed25519")` for node identity; stored in `nodes` table
- **`/.well-known/federation`** — public discovery endpoint returning node metadata, public key, capabilities
- **`POST /api/federation/handshake`** — initiates a signed handshake with a remote node; records result in `federation_events`
- **`POST /api/federation/ping`** — receives and verifies an Ed25519-signed ping from a peer node
- **`POST /api/nodes/:id/generate-keys`** — generate or rotate Ed25519 key pair
- **`federation_events` table** — persistent log of all handshake, ping, sync, offline, and key rotation events
- **`GET /api/federation/peers`** — list remote peer nodes
- **`GET /api/federation/events`** — federation event log
- **`POST /api/federation/notify-sync`** — manually trigger sync notification to all active peers
- **Federation Protocol page** — UI for node identity, handshake initiation, event log, and API reference

---

## [0.0.1] — Phase 1: Auth + File Serving

### Added
- **Replit Auth** — OpenID Connect + PKCE login flow; users own sites and deployments
- **Object storage** — presigned URL upload flow; file bytes go directly to storage, not through the API server
- **Site serving** — `GET /api/sites/serve/:domain/*` streams files from object storage by domain + path
- **Database schema** — `users`, `sessions`, `sites`, `site_deployments`, `site_files`, `nodes` tables
- **React frontend** — Dashboard, My Sites, Deploy Site (drag-and-drop uploader), Node List, Node Detail, Site List, Site Detail pages
- **Federation Protocol page** — initial version with node list and basic metadata
- **pnpm monorepo** — TypeScript project references; shared `@workspace/db`, `@workspace/api-zod`, `@workspace/api-client-react`
- **OpenAPI 3.1 spec** — source of truth for all API shapes; Orval codegen for Zod validators and React Query hooks

---

## [0.7.0] — Phase 7: Webhooks, E2E Tests, Analytics CLI, Status Command

### Added

**Webhook notification system** (`lib/webhooks.ts`)
- `deliverWebhook()` — fire-and-forget POST to all `WEBHOOK_URLS` with Ed25519 signature
- Events: `node_offline`, `node_online`, `deploy`, `deploy_failed`, `new_peer`
- `GET /api/webhooks/config` — view configured webhook URLs (credentials redacted)
- `POST /api/webhooks/test` — send a test payload to all configured webhook endpoints
- Wired into health monitor (node offline/online), deploy route (deploy), gossip (new peer)

**Playwright E2E test suite** (`e2e/`)
- `playwright.config.ts` — configured for Chromium + mobile Safari, `FH_BASE_URL` env var
- `e2e/health.spec.ts` — health endpoints, federation discovery, public site endpoints, rate limit smoke
- `e2e/deploy.spec.ts` — 11-step critical path test: auth → create site → upload → deploy → serve → analytics → rollback → cleanup
- `e2e/helpers.ts` — shared fixtures including `authedRequest` context with Bearer token

**CLI additions**
- `fh analytics --site <id> [--period 24h|7d|30d]` — traffic stats with ASCII bar charts, top paths + referrers
- `fh status` — node health, federation metadata, network capacity summary

**CI pipeline** (`.github/workflows/ci.yml`)
- TypeScript typecheck, OpenAPI validation (Redocly lint), build (API + frontend + CLI), Docker build check
- Concurrency group cancellation — no wasted CI minutes on stale runs

**OpenAPI spec v0.7.0** (`lib/api-spec/openapi.yaml`)
- All Phase 5+6 routes fully documented: tokens, access control, custom domains, analytics, admin, gossip, bootstrap, rollback, federation sync + manifest, webhooks

### Changed
- `healthMonitor.ts` — fires `webhookNodeOffline` / `webhookNodeOnline` on status transitions
- `deploy.ts` — fires `webhookDeploy` after every successful deploy
- `gossip.ts` — fires `webhookNewPeer` when gossip registers a new node
- `routes/index.ts` — webhooks router registered
- `ROADMAP.md` — Phase 6 marked ✅, Phase 7 items updated


---

## [0.8.0] — Phase 8: i18n, Marketplace, TLS, API Docs, CLI npm publish

### Added

**Bahasa Indonesia internationalisation**
- `src/i18n/en.json` — complete English translation strings for all UI text
- `src/i18n/id.json` — complete Bahasa Indonesia translations (all nav, dashboard, deploy, analytics, tokens, admin, onboarding)
- `src/i18n/index.ts` — i18next config with browser language detection + localStorage persistence
- `LanguageSwitcher.tsx` — dropdown component in sidebar footer (🇬🇧 English / 🇮🇩 Bahasa Indonesia)
- i18next, react-i18next, i18next-browser-languagedetector added to dependencies
- Language preference stored in `fh_language` localStorage key

**Node Network marketplace** (`pages/Marketplace.tsx`)
- Searchable grid of all federation nodes with online/offline status
- Per-node: name, domain, region, site count, storage, uptime, verified status
- Bootstrap endpoint info box with copy button
- Summary stat cards (total/online/verified/bootstrap nodes)
- One-click domain copy, Inspect link to `/.well-known/federation`

**ACME / Let's Encrypt TLS automation** (`routes/tls.ts`)
- `GET /.well-known/acme-challenge/:token` — serves HTTP-01 challenges at root level
- `GET /api/domains/:id/tls-status` — cert existence check, expiry, provisioning state
- `POST /api/domains/:id/provision-tls` — registers challenge token; if `ACME_ENABLED=true` issues token; otherwise returns Caddy/certbot instructions
- Challenge tokens expire after 10 minutes, cleaned up automatically

**API Reference page** (`pages/ApiDocs.tsx`)
- All endpoints grouped by tag (Health, Sites, Analytics, Federation, Access & Tokens, Admin)
- Tag filter bar for fast navigation
- Auth section: session cookie vs Bearer token with copy examples
- Code examples: CLI deploy, fetch API, federation handshake, custom domain verification
- Links to FEDERATION.md, SELF_HOSTING.md, GitHub repo

**CLI npm publish readiness**
- Package renamed `@fedhost/cli` (was `@workspace/cli`)
- Added `author`, `license`, `homepage`, `repository`, `bugs`, `keywords`, `engines` fields
- `files` list: `dist/`, `README.md`
- `prepublishOnly` script runs `build` automatically
- `README.md` with install, quick start, command table, GitHub Actions snippet
- `.npmignore` excluding source files from npm bundle

### Changed
- `App.tsx` — `/network` and `/api-docs` routes added
- `Layout.tsx` — Node Network + API Reference added to nav; LanguageSwitcher in sidebar footer
- `routes/index.ts` + `app.ts` — TLS router registered (ACME challenge at root, domain routes at `/api`)
- `ROADMAP.md` — Phase 8 items updated: i18n ✅, marketplace ✅, TLS ✅, API docs ✅, CLI publish 📋


---

## [0.9.0] — Security hardening, geographic routing, conflict resolution

### Security (critical fixes)
- `PATCH /sites/:id` — now requires authentication + site ownership (was completely unprotected)
- `DELETE /sites/:id` — now requires authentication + site ownership (was completely unprotected)
- `POST /nodes`, `PATCH /nodes/:id`, `DELETE /nodes/:id` — now requires authentication
- Rate limiting applied to all previously unprotected write endpoints:
  - `writeLimiter` (60/min): POST/PATCH/DELETE sites, nodes, members, domains, rollback, discover
  - `tokenLimiter` (10/hr): POST /tokens — prevents token harvesting
  - `webhookLimiter` (20/hr): POST /webhooks/test

### Added

**Geographic routing** (`lib/geoRouting.ts`)
- `inferRegionFromRequest()` — extracts client region from Fly-Region, CF-IPCountry, CloudFront-Viewer-Country, X-Geo-Region headers
- `selectClosestNode()` — picks best peer by exact region match → region prefix match → fallback to local
- `geoRoutingMiddleware` — Express middleware issuing 302 redirects to closest node for site serving; activated by `ENABLE_GEO_ROUTING=true`
- Country-to-region + fly.io region code mapping covering all major markets (Indonesia → ap-southeast-3 priority)
- Mounted in `app.ts` before host router; never breaks requests (errors fall through)

**Same-domain conflict resolution** (`lib/conflictResolution.ts`)
- `resolveConflict()` — deterministic trust-chain algorithm:
  1. Same-origin update → always accept
  2. Invalid Ed25519 signature → reject
  3. Earlier `joinedAt` wins (first-write-wins)
  4. Equal timestamps: lexicographically smaller public key wins
- Integrated into `POST /federation/sync` — conflicting domains return `409 Conflict` with winner/reason
- Logs all conflict resolution decisions for auditability

### Changed
- `app.ts` — `geoRoutingMiddleware` mounted before `hostRouter`; `tlsRouter` mounted at root
- `federation.ts` — conflict resolution applied before file download in sync handler
- `nodes.ts` — auth + `writeLimiter` on all write routes
- `rateLimiter.ts` — `writeLimiter`, `tokenLimiter`, `webhookLimiter` added
- ROADMAP: geographic routing ✅, conflict resolution ✅, rate limiting all writes ✅

---

## [0.9.1] — i18n wiring, security tests, npm publish workflow

### Added
- `e2e/security.spec.ts` — 20+ auth enforcement tests, public endpoint tests, conflict/rate-limit smoke tests
- `.github/workflows/publish-cli.yml` — npm publish workflow for `@fedhost/cli` (manual trigger + `cli-v*` tags)
- `.env.example` — fully documented: all 18 env vars with descriptions, examples, correct defaults
  (previously only covered 4 vars)

### Changed

**i18n applied to pages** — `useTranslation` and `t()` wired in:
- `Dashboard.tsx` — title, subtitle, all 5 stat card titles, chart title/subtitle, no-activity text, consensus heading, welcome banner
- `MySites.tsx` — title, subtitle (with count), sign-in prompt, empty state
- `DeploySite.tsx` — Upload Files heading, dropzone text, Deploy/Deploying buttons, Deployment History, Rollback, View Live, Analytics
- `SiteAnalytics.tsx` — all 4 stat cards, chart labels, top pages/referrers section titles, empty states, period selector labels, direct referrer label
- `Tokens.tsx` — title, subtitle, no-tokens state, create/created dialog titles, action buttons
- `Admin.tsx` — previously wired (title, refresh, edit, save, system/identity section headings)

**Auth hardening** — final gaps closed:
- `PATCH /admin/node` — `writeLimiter` applied
- `POST /nodes/:id/generate-keys` — `writeLimiter` + `isAuthenticated()` check added
- `federation.ts` — `writeLimiter` imported and used

