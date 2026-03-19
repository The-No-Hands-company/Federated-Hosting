# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## GitHub

Repository: https://github.com/The-No-Hands-company/Federated-Hosting
Token stored as secret: `GITHUB_PERSONAL_ACCESS_TOKEN`

### Pushing changes — always follow this order:

1. Check for and remove any stale lock files first:
```bash
rm -f .git/index.lock .git/refs/remotes/github/main.lock
```
2. Verify git is clean:
```bash
git status
```
3. Push:
```bash
git push github master:main
```

**Before every push**, check for lock files with:
```bash
ls .git/*.lock .git/refs/remotes/github/*.lock 2>/dev/null
```
If any exist, delete them with `rm -f` before proceeding.

## Project: Federated Hosting Service

A **real federated hosting service** — users log in, upload website files, deploy sites, and independent nodes form a cryptographically verified federation network to collectively host websites.

### Architecture Phases

#### Phase 1 — Auth + Object Storage + Site Serving ✅
- **Replit Auth** — OpenID Connect login; users own sites and deployments
- **Object Storage** — presigned URL upload flow to Replit object storage
- **Site Serving** — `GET /api/sites/serve/:domain/*` streams files from object storage
- **DB tables** — `users`, `sessions`, `site_deployments`, `site_files` (+ `ownerId` on `sites`)
- **Frontend** — My Sites page, Deploy Site page with drag-and-drop uploader

#### Phase 2 — Federation Protocol ✅
- **Ed25519 key pairs** — each node gets a cryptographic identity; generated on creation via `crypto.generateKeyPairSync("ed25519")`
- **`/.well-known/federation`** — discovery endpoint returning node metadata, public key, capabilities
- **`POST /api/federation/handshake`** — initiates signed handshake with a remote node
- **`POST /api/federation/ping`** — receives Ed25519-signed ping; verifies and updates node `verifiedAt`
- **`POST /api/nodes/:id/generate-keys`** — rotate Ed25519 key pair for any node
- **`federation_events` table** — persistent log of all handshake/ping/sync/offline events
- **Deploy → replication** — on site deploy, notifies all active peer nodes via signed `site_sync` events
- **Federation Protocol page** — UI for node identity, handshake initiation, event log, API reference

#### Phase 3 — Subdomain Routing + Replication ✅
- **Host-header routing** (`middleware/hostRouter.ts`) — any request with a `Host` header matching a registered site domain is served directly (bypasses `/api/sites/serve`)
- **Replication on deploy** — deploy endpoint iterates active peers, sends signed `site_sync` notification with `X-Federation-Signature` header
- **Node capacity API** — `GET /api/capacity/summary` (network overview), `GET /api/nodes/:id/capacity` (per-node storage stats), `POST /api/nodes/:id/update-capacity`
- **Auto-init startup** — `index.ts` ensures a local node record exists with Ed25519 keys on every boot

### Key Files

| File | Purpose |
|------|---------|
| `artifacts/api-server/src/lib/federation.ts` | Ed25519 key gen, sign, verify helpers |
| `artifacts/api-server/src/lib/objectStorage.ts` | Object storage (presigned upload/download) |
| `artifacts/api-server/src/middleware/hostRouter.ts` | Phase 3: host-header site routing |
| `artifacts/api-server/src/routes/federation.ts` | Federation protocol endpoints |
| `artifacts/api-server/src/routes/capacity.ts` | Node capacity management |
| `artifacts/api-server/src/routes/deploy.ts` | File upload, site deploy, replication |
| `artifacts/api-server/src/routes/auth.ts` | Replit Auth OIDC routes |
| `lib/db/src/schema/nodes.ts` | Nodes table (Ed25519 keys, isLocalNode) |
| `lib/db/src/schema/federation.ts` | Federation events table |
| `lib/db/src/schema/deployments.ts` | site_deployments + site_files tables |
| `artifacts/federated-hosting/src/pages/Federation.tsx` | Federation Protocol UI page |
| `artifacts/federated-hosting/src/pages/MySites.tsx` | Authenticated site management |
| `artifacts/federated-hosting/src/pages/DeploySite.tsx` | File upload + deployment UI |

### Federation Protocol

```
GET  /.well-known/federation          Node discovery (name, publicKey, capabilities)
POST /api/federation/ping             Signed ping verification
POST /api/federation/handshake        Initiate handshake with remote node
GET  /api/federation/peers            List registered federation peers
GET  /api/federation/events           Event log (last 100 events)
POST /api/federation/notify-sync      Notify peers of a site deployment
POST /api/nodes/:id/generate-keys     Generate/rotate Ed25519 keys
GET  /api/capacity/summary            Network-wide capacity overview
GET  /api/nodes/:id/capacity          Per-node capacity stats
```

### Stack additions (post-initial-scaffold)

- `artifacts/federated-hosting` — React + Vite frontend (at path `/`)
- `lib/db/src/schema/nodes.ts` — nodes table with federation node data + Ed25519 keys
- `lib/db/src/schema/sites.ts` — sites table with hosted site data
- `lib/db/src/schema/deployments.ts` — site_deployments + site_files tables
- `lib/db/src/schema/federation.ts` — federation_events table
- `lib/integrations/replit-auth-web` — `useAuth()` hook (no AuthProvider needed)
- `lib/integrations/object-storage` — ObjectStorageService wrapper
- `scripts/src/seed.ts` — seed script for sample data

## Structure

```text
artifacts-monorepo/
├── artifacts/              # Deployable applications
│   ├── api-server/         # Express API server
│   │   └── src/
│   │       ├── app.ts               # Express setup + host router + .well-known
│   │       ├── index.ts             # Startup + ensureLocalNode()
│   │       ├── lib/federation.ts    # Ed25519 crypto helpers
│   │       ├── lib/objectStorage.ts # Object storage service
│   │       ├── middleware/
│   │       │   ├── authMiddleware.ts
│   │       │   └── hostRouter.ts    # Phase 3: host-header site routing
│   │       └── routes/
│   │           ├── auth.ts, deploy.ts, federation.ts
│   │           ├── capacity.ts, nodes.ts, sites.ts, stats.ts
│   └── federated-hosting/  # React + Vite frontend
│       └── src/pages/
│           ├── Dashboard.tsx, Federation.tsx
│           ├── MySites.tsx, DeploySite.tsx
│           └── nodes/, sites/
├── lib/                    # Shared libraries
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   ├── db/                 # Drizzle ORM schema + DB connection
│   └── integrations/       # replit-auth-web, object-storage
├── scripts/                # Utility scripts
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── tsconfig.json
└── package.json
```

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references. This means:

- **Always typecheck from the root** — run `pnpm run typecheck` (which runs `tsc --build --emitDeclarationOnly`). This builds the full dependency graph so that cross-package imports resolve correctly. Running `tsc` inside a single package will fail if its dependencies haven't been built yet.
- **`emitDeclarationOnly`** — we only emit `.d.ts` files during typecheck; actual JS bundling is handled by esbuild/tsx/vite...etc, not `tsc`.
- **Project references** — when package A depends on package B, A's `tsconfig.json` must list B in its `references` array. `tsc --build` uses this to determine build order and skip up-to-date packages.

## Root Scripts

- `pnpm run build` — runs `typecheck` first, then recursively runs `build` in all packages that define it
- `pnpm run typecheck` — runs `tsc --build --emitDeclarationOnly` using project references

## Phase 5 — UX Polish + Protocol Spec ✅

### My Sites (improved)
- Inline "Register Site" modal — no navigation away
- Hit count (visits) displayed per site card
- Last-updated timestamp via `date-fns`
- Animated card grid with staggered entry
- Improved empty state with step-by-step guidance

### Bug fixes
- `trust proxy` set to `1` in `app.ts` — fixes `express-rate-limit` `X-Forwarded-For` errors in all proxy environments
- Pagination unwrapping — `useNodes()` / `useSites()` wrappers in `apiHooks.ts` correctly handle `{ data, meta }` shape from all list endpoints

### Federation Protocol Spec
- `FEDERATION.md` — language-agnostic spec covering node identity, Ed25519 signing, discovery endpoint, handshake protocol, site sync notifications, capability strings, security considerations, and interoperability notes

## Production Hardening (Phase 4) ✅

### Security middleware stack (app.ts)
- **helmet** — CSP, HSTS, X-Frame-Options, X-Content-Type-Options
- **Rate limiting** — global 200 req/min; auth/upload endpoints 20 req/min (using `express-rate-limit`)
- **Compression** — gzip via `compression`
- **Body limits** — 10 MB JSON, 1 MB URL-encoded
- **X-Request-ID** — every request gets a unique UUID traceable through logs

### Structured logging (lib/logger.ts)
- **pino** JSON logging in production, pretty-printed in development
- **pino-http** request logging with method, URL, status, response time
- **Redaction** — `privateKey` and `password` fields never appear in logs
- **devDep**: `pino-pretty` for readable local output

### Error handling (lib/errors.ts + middleware/errorHandler.ts)
- **AppError** — typed error class with `statusCode`, `code`, `isOperational`
- **asyncHandler** — wraps async route handlers, eliminates try/catch boilerplate
- **globalErrorHandler** — structured JSON error responses, no stack traces in prod
- **404 handler** — fallback for unmatched routes

### Pagination (lib/pagination.ts)
- All list endpoints return `{ data: [...], meta: { total, page, limit, totalPages, hasNextPage, hasPrevPage } }`
- Endpoints: `GET /api/nodes`, `GET /api/sites`, `GET /api/federation/peers`, `GET /api/federation/events`
- Query params: `?page=1&limit=20`

### DB indexes (schema inline)
- `sites`: `ownerId`, `status`, `primaryNodeId` indexes
- `nodes`: `status`, `isLocalNode` indexes
- `site_deployments`: `siteId`, `status` indexes
- `site_files`: `siteId`, `siteId+filePath` (composite), `deploymentId` indexes
- `federation_events`: `eventType`, `fromNodeDomain`, `createdAt` indexes

### Deploy safety
- Full DB transaction wrapping deployment creation + file assignment + site update
- `Promise.allSettled` for peer replication (never fails the deploy if peers are down)
- File path sanitization (prevents directory traversal)
- 50 MB per-file limit, 500 MB per-deployment limit
- Allowed content types whitelist

### Graceful shutdown (index.ts)
- `SIGTERM` / `SIGINT` — drains in-flight requests, closes DB pool cleanly
- `unhandledRejection` + `uncaughtException` handlers

### Frontend error handling (App.tsx + ErrorBoundary.tsx)
- `ErrorBoundary` wraps all routes — shows friendly error UI with "Try Again"
- `QueryCache` + `MutationCache` global error handlers — auto-redirect to login on 401
- Exponential retry backoff; no retries on 4xx errors

### New files
| File | Purpose |
|------|---------|
| `artifacts/api-server/src/lib/errors.ts` | AppError class + asyncHandler wrapper |
| `artifacts/api-server/src/lib/logger.ts` | Pino logger with redaction |
| `artifacts/api-server/src/lib/pagination.ts` | Pagination utilities |
| `artifacts/api-server/src/middleware/errorHandler.ts` | Global error + 404 handlers |
| `artifacts/api-server/src/middleware/rateLimiter.ts` | Rate limiter instances |
| `artifacts/federated-hosting/src/components/ErrorBoundary.tsx` | React error boundary |

## Key Notes

- **Auth**: `useAuth()` from `@workspace/replit-auth-web` — no AuthProvider needed. Routes: `/api/login`, `/api/callback`, `/api/logout`, `/api/auth/user`
- **Zod names**: Orval generates names from operationId. Verify with `grep "export const" lib/api-zod/src/generated/api.ts`
- **Date serialization**: call `serializeDates()` from `artifacts/api-server/src/lib/serialize.ts` before `.parse()` in routes
- **pnpm overrides**: root package.json has react 19.1.0 override for Uppy compatibility
- **Local node**: On startup, `ensureLocalNode()` creates node record with Ed25519 keys if none exists; manually update `is_local_node=1` if needed
- **DB push**: `pnpm --filter @workspace/db run push` to sync schema changes
- **Health endpoints**: `GET /api/health` (full), `/api/health/live` (liveness), `/api/health/ready` (readiness)
- **Pagination**: All list endpoints now return `{ data, meta }` — frontend must handle this shape
