# CLAUDE.md — Federated Hosting Development Charter

## What this project is

**Federated Hosting is a production-grade, decentralised static site hosting network.**

This is not a toy. This is not a proof of concept. This is infrastructure intended to serve **over 1.5 billion people** — with a specific focus on the Global South, Southeast Asia, and markets currently underserved by centralised cloud providers. Every line of code written here is load-bearing.

Design and build accordingly.

---

## Core principles

### 1. Production-grade or nothing
Every feature ships with:
- Proper error handling (no unhandled promise rejections, no silent failures)
- Input validation at the boundary (Zod schemas on every route)
- Database transactions where atomicity matters
- Structured logging with context (`logger.info({ siteId, userId }, "message")`)
- Graceful degradation — never let a failed peer sync crash a local deploy

### 2. Security is non-negotiable
- All node-to-node communication is Ed25519-signed
- No trusting `X-Forwarded-*` headers without `trust proxy` set
- No raw SQL string interpolation — Drizzle ORM only
- File paths sanitised before storage (directory traversal prevention)
- Tokens hashed before storage (SHA-256 for API tokens, scrypt for passwords)
- Rate limiting on every write endpoint, not just federation ones
- Never log private keys, passwords, or tokens

### 3. The federation protocol is a first-class citizen
The network only works if nodes can trust each other and reliably replicate content. Federation logic must be:
- Cryptographically verified (Ed25519 signatures on all inter-node messages)
- Resilient to partial failure (`Promise.allSettled`, never `Promise.all` for peer ops)
- Logged to `federation_events` for auditability
- Documented in `FEDERATION.md` (language-agnostic spec for third-party implementors)

### 4. The database schema is the source of truth
- Schema lives in `lib/db/src/schema/`
- Changes go through **Drizzle migrations** (`pnpm --filter @workspace/db run migrate`) — never `db push` in production
- Every table has created/updated timestamps
- Every hot query path has an index
- Foreign keys use `onDelete: "cascade"` where appropriate

### 5. The API is a public contract
- OpenAPI spec in `lib/api-spec/openapi.yaml` must stay in sync with actual routes
- Breaking changes require a version bump
- All list endpoints return `{ data: [...], meta: { total, page, limit } }`
- All error responses return `{ message: string, code: string, status: number }`

---

## Architecture overview

```
Browser / CLI
    │
    ▼
artifacts/federated-hosting    ← React + Vite frontend (port 25231 in dev)
    │ fetch()
    ▼
artifacts/api-server           ← Express 5 API (port 8080 in dev)
    │
    ├── lib/db                 ← Drizzle ORM + PostgreSQL
    ├── lib/objectStorage      ← deprecated shim → use storageProvider.ts
    ├── federation peers       ← Other nodes (Ed25519-verified)
    └── background jobs        ← healthMonitor, analyticsFlush, gossipPusher
```

### Monorepo structure
```
lib/
  db/                    ← Schema, migrations, DB connection
  api-spec/              ← OpenAPI 3.1 spec + Orval codegen config
  api-client-react/      ← Generated React Query hooks (from OpenAPI)
  api-zod/               ← Generated Zod schemas (from OpenAPI)
  auth-web/       ← useAuth() hook
  object-storage-web/    ← Upload component + useUpload hook

artifacts/
  api-server/            ← Express API server
  federated-hosting/     ← React + Vite frontend
  cli/                   ← fh CLI tool (deploy, sites, tokens)

docs/
  API.md                 ← REST API reference
  ARCHITECTURE.md        ← System design
  FEDERATION_PROTOCOL.md ← Inter-node protocol spec
  SELF_HOSTING.md        ← Docker + manual deployment guide
  CHANGELOG.md           ← Version history

FEDERATION.md            ← Language-agnostic federation spec (root)
ROADMAP.md               ← Living feature tracker
CLAUDE.md                ← This file
```

---

## Development workflow

### Setup
```bash
pnpm install
cp .env.example .env       # fill in DATABASE_URL, object storage config
pnpm --filter @workspace/db run migrate   # apply migrations
pnpm run dev               # starts API (:8080) + frontend (:25231) concurrently
```

### Making schema changes
```bash
# 1. Edit lib/db/src/schema/*.ts
# 2. Generate a migration
pnpm --filter @workspace/db run generate
# 3. Review the generated SQL in lib/db/migrations/
# 4. Apply it
pnpm --filter @workspace/db run migrate
# 5. Commit BOTH the schema change AND the migration file
```

### Adding a new API route
1. Create `artifacts/api-server/src/routes/myfeature.ts`
2. Use `asyncHandler` + `AppError` — no raw try/catch in routes
3. Validate all inputs with Zod at the top of the handler
4. Register the router in `artifacts/api-server/src/routes/index.ts`
5. Add the endpoint to `lib/api-spec/openapi.yaml`
6. Regenerate client: `pnpm --filter @workspace/api-spec run generate`
7. Update `docs/API.md`

### Pushing to GitHub
```bash
# Always check for stale lock files first
ls .git/*.lock .git/refs/remotes/origin/*.lock 2>/dev/null && rm -f .git/*.lock .git/refs/remotes/origin/*.lock
git status
git add -A
git commit -m "feat|fix|chore|docs: description"
git push origin main
```

---

## Scale considerations

At 1.5B+ users, the following matter from day one:

### Database
- **Connection pooling** — the DB pool is shared across all requests; never open ad-hoc connections
- **Indexes on every foreign key and hot filter** — already in schema; don't add columns without thinking about query patterns
- **Pagination everywhere** — no endpoint returns unbounded lists
- **Analytics are buffered** — `analytics_buffer` absorbs per-request writes; `analyticsFlush` rolls up once per minute. Never write to `site_analytics` directly from a request handler.

### Federation
- **Gossip propagates peer lists** — nodes don't need manual registration; the gossip pusher runs every 5 minutes
- **Sync is eventually consistent** — a deploy pushes `site_sync` notifications; peers pull files asynchronously. A peer being down doesn't fail the deploy.
- **Signatures prevent spoofing** — every inter-node message includes an Ed25519 signature. Verify before trusting.

### Object storage
- **Files are immutable** — once uploaded to object storage, a file at a given `objectPath` never changes. Deployments are versioned by creating new file records.
- **Presigned URLs** — clients upload/download directly from object storage; the API server never proxies file bytes (except for serving via `hostRouter`)

### CDN / edge (future)
- The `X-Served-By: federated-hosting` and `Cache-Control: public, max-age=3600` headers are already set on all served files
- The architecture is designed for a CDN layer to sit in front of nodes

---

## Code style

- **TypeScript strict mode** — no `any` unless genuinely unavoidable; add a comment explaining why
- **No `console.log`** — use the pino logger (`import logger from "../lib/logger"`)
- **Async handlers** — wrap every async route in `asyncHandler()`; never `.catch(next)` manually
- **Zod for all external input** — request bodies, query params, URL params
- **Drizzle for all DB access** — no raw SQL except in migrations
- **Named exports** — avoid default exports in lib files; use them only in React pages/components
- **`date-fns` for date formatting** — not `toLocaleString()` or manual formatting

---

## Testing

A full Playwright E2E suite is a high-priority item on the roadmap. Until it exists:

- Test the critical path manually before every push: sign in → register site → upload files → deploy → verify site serves
- Backend routes should be testable with `curl` or the built-in API reference in the Federation Protocol page
- The `scripts/src/seed.ts` script creates realistic test data

---

## What not to do

- **Don't break the federation protocol** — `FEDERATION.md` is a public spec; changes must be backwards-compatible or versioned
- **Don't remove Drizzle transactions** from the deploy endpoint — partial deployments corrupt site state
- **Don't add legacy dependencies** without an abstraction layer — the project must remain self-hostable
- **Don't return stack traces in production** — the global error handler already strips them; don't bypass it
- **Don't log private keys** — the pino logger has `privateKey` and `password` in its redaction list, but don't work around it
- **Don't use `Promise.all` for peer operations** — always `Promise.allSettled`; a dead peer must never crash a user-facing request

---

## Ownership

**The No Hands Company** — https://github.com/The-No-Hands-company

This codebase is MIT licensed. Contributions welcome — see `CONTRIBUTING.md`.
