# Nexus Hosting

A production-grade **federated website hosting service** where users deploy static sites and independent nodes form a cryptographically verified network. No single company controls the infrastructure — anyone can run a node.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-24-green.svg)](https://nodejs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-blue.svg)](https://www.postgresql.org/)

---

## What is Nexus Hosting?

Nexus Hosting lets users:

1. **Log in** via OIDC Auth (OpenID Connect)
2. **Upload** website files (HTML, CSS, JS, images, fonts) to object storage
3. **Deploy** their site — gets a unique domain, version-tracked, atomically committed
4. **Replicate** — the deploy is automatically mirrored to all active federation peers via signed `site_sync` events
5. **Serve** — any node in the network can serve any site, routed by host header

Independent operators run nodes. Each node has an **Ed25519 cryptographic identity**, participates in the federation protocol, and can host and replicate sites for the network.

---

## Running a node (operators)

**[→ Full operator guide: docs/SELF_HOSTING.md](./docs/SELF_HOSTING.md)**

The short version:

```bash
git clone https://github.com/The-No-Hands-company/Nexus-Hosting.git
cd Nexus-Hosting
cp .env.example .env
# Edit .env — the required vars are: ISSUER_URL, OIDC_CLIENT_ID, COOKIE_SECRET,
# DATABASE_URL, PUBLIC_DOMAIN, and your S3 credentials
docker compose up -d
```

**Required configuration before the server will start:**

| Variable | How to get it |
|---|---|
| `ISSUER_URL` + `OIDC_CLIENT_ID` | Set up Authentik, Keycloak, or Auth0. See [SELF_HOSTING.md → Auth](./docs/SELF_HOSTING.md#auth) |
| `COOKIE_SECRET` | `openssl rand -hex 32` |
| `DATABASE_URL` | PostgreSQL connection string |
| `PUBLIC_DOMAIN` | Your node's public hostname |
| `OBJECT_STORAGE_ENDPOINT` + credentials | AWS S3, Cloudflare R2, MinIO, or Backblaze B2 |

See [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) for the complete environment variable reference, and [docs/PRODUCTION_CHECKLIST.md](./docs/PRODUCTION_CHECKLIST.md) before going live.

---

## Quick Start (development)

### Prerequisites

- [Node.js 24+](https://nodejs.org/)
- [pnpm 10+](https://pnpm.io/)
- PostgreSQL database
- S3-compatible object storage (MinIO via Docker Compose works)

### Install

```bash
git clone https://github.com/The-No-Hands-company/Nexus-Hosting.git
cd Nexus-Hosting
pnpm install
```

### Minimum environment for development

```env
DATABASE_URL=postgresql://user:password@localhost:5432/nexus
ISSUER_URL=https://your-oidc-provider/
OIDC_CLIENT_ID=your-client-id
COOKIE_SECRET=dev-only-change-in-production
PUBLIC_DOMAIN=localhost:8080
OBJECT_STORAGE_ENDPOINT=http://localhost:9000
OBJECT_STORAGE_ACCESS_KEY=minioadmin
OBJECT_STORAGE_SECRET_KEY=minioadmin
DEFAULT_OBJECT_STORAGE_BUCKET_ID=nexus-sites
NODE_ENV=development
```

### Database Setup

```bash
pnpm --filter @workspace/db run migrate
```

### Development

```bash
pnpm run dev  # starts API on :8080 and frontend on :25231
```

### Build

```bash
pnpm run build
```

---

## Features

### Hosting
- **Deploy static sites** — drag-and-drop or `nh deploy` CLI — HTML, CSS, JS, images, fonts
- **Git-powered builds** — connect a repo, push to deploy; build cache skips install on unchanged lockfiles
- **Preview deployments** — non-main branches automatically get a `{branch}--{domain}` preview URL
- **Rollback** — one click to revert to any previous deployment
- **Deployment diff** — visual +/~/- file panel shows exactly what changed
- **Dynamic sites** — NLPL, Node.js, and Python HTTP servers with process manager and port pool
- **Custom domains** — CNAME + TXT verification, automatic TLS via ACME or Caddy
- **SPA routing** — per-site toggle for index.html fallback vs strict 404
- **Site visibility** — public / private / password-protected (HMAC-signed cookies)

### Federation
- **Ed25519 cryptographic identity** — each node has a verifiable key pair
- **`/.well-known/federation`** discovery endpoint with capabilities declaration
- **Signed handshakes** — nodes verify each other's identity before peering
- **Node trust scoring** — unverified → verified → trusted (at 50 successful pings)
- **Gossip peer discovery** — DB-backed, multi-instance safe
- **Site sync** — deployments automatically replicated to all active peers (Ed25519 signed)
- **Sync retry queue** — exponential backoff (30s → 2m → 10m → 1h → 6h), max 10 attempts
- **Conflict resolution** — first-write-wins + public key tiebreaker
- **Federation blocklist** — defederate nodes with full CRUD and gossip enforcement
- **Bootstrap seeding** — `BOOTSTRAP_URLS` env var to discover initial peers on first start
- **Replay attack protection** — 5-minute timestamp window on all signed federation messages

### Security & Moderation
- **Email verification** — SHA-256 tokens, 24h TTL, sent on login, dashboard resend banner
- **IP banning** — exact IP and CIDR-range subnet bans, 60s cached, admin CRUD
- **Abuse reports** — public report form (8 categories), admin review/takedown flow
- **Content scanning hook** — configurable `CONTENT_SCAN_WEBHOOK_URL` for external scanner
- **Admin RBAC** — `requireAdmin` middleware, `isAdmin` DB flag + `ADMIN_USER_IDS` env var
- **Rate limiting** — 7 Redis-backed limiters; per-user, per-IP, per-endpoint
- **HMAC-signed password gates** — `timingSafeEqual` verified, 5-attempt brute-force limit
- **API tokens** — SHA-256 hashed, scoped (read/write/deploy), managed via dashboard + CLI

### Operator Tools
- **Admin dashboard** — users, all sites, audit log, health monitor, processes, moderation
- **Per-user storage cap** — operator-set per-user limit (default: 0 = unlimited); not a paywall
- **User suspension** — suspend abusive users without deleting data
- **Prometheus metrics** — 13 metrics, `/metrics` endpoint, Grafana dashboards included
- **Structured logging** — Pino, request IDs, private keys/passwords redacted
- **Audit log** — every admin action recorded with actor, target, and detail
- **Webhook notifications** — Ed25519 signed, delivery log, 5-attempt retry queue

### CLI (`fh`)
- `nh deploy` / `nh rollback` / `nh status`
- `nh sites` / `nh domains` / `nh teams`
- `nh env` / `nh forms` / `nh logs` / `nh watch`
- `nh create --type` — static templates (HTML/React/Vue/Next/Svelte) + dynamic (nlpl/node/python)
- `nh analytics` / `nh tokens`

### Infrastructure
- **Rust proxy** (`crates/nexus-proxy`) — Brotli/gzip compression, LRU cache, Redis cache invalidation, S3 streaming, Prometheus metrics, geographic routing
- **Docker Compose** — Redis + MinIO + Caddy + Rust proxy, all wired
- **ACME/Let's Encrypt** — HTTP-01 + DNS-01, 12h renewal scheduler, expiry email notifications
- **Geographic routing** — closest-node redirect based on request headers, 40+ country mappings
- **Bahasa Indonesia i18n** — lazy-loaded, HTTP backend, Indonesia-first for SEA nodes

---

## API Reference

See [docs/API.md](./docs/API.md) for the full REST API reference.

**Base URL:** `https://your-node/api`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Full health check |
| GET | `/health/live` | Liveness probe |
| GET | `/health/ready` | Readiness probe |
| GET | `/auth/user` | Current user |
| GET | `/nodes` | List nodes (paginated) |
| POST | `/nodes` | Register node |
| GET | `/sites` | List sites (paginated) |
| POST | `/sites` | Create site |
| POST | `/sites/:id/files/upload-url` | Get presigned upload URL |
| POST | `/sites/:id/files` | Register uploaded file |
| POST | `/sites/:id/deploy` | Deploy site |
| GET | `/sites/:id/deployments` | Deployment history |
| GET | `/federation/meta` | Node metadata |
| POST | `/federation/handshake` | Initiate handshake |
| POST | `/federation/ping` | Signed ping |
| GET | `/federation/peers` | Federation peers (paginated) |
| GET | `/federation/events` | Event log (paginated) |
| GET | `/capacity/summary` | Network capacity |

---

## Architecture

See [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for full system design.

```
Browser → Nexus Hosting UI (Vite/React)
             ↓
         API Server (Express 5, TypeScript)
             ↓
     ┌───────┴───────┐
 PostgreSQL     Object Storage
  (Drizzle)    (presigned URLs)
     ↓
 Federation Peers (other nodes, Ed25519 verified)
```

---

## Project Structure

```
.
├── artifacts/
│   ├── api-server/          # Express 5 API server
│   │   └── src/
│   │       ├── app.ts       # Middleware stack
│   │       ├── index.ts     # Startup + graceful shutdown
│   │       ├── lib/         # federation, objectStorage, errors, logger, pagination
│   │       ├── middleware/  # authMiddleware, hostRouter, errorHandler, rateLimiter
│   │       └── routes/      # auth, deploy, federation, nodes, sites, capacity, health
│   └── nexus-hosting/   # React + Vite frontend
│       └── src/
│           ├── pages/       # Dashboard, MySites, DeploySite, Federation, Nodes, Sites
│           └── components/  # Layout, ErrorBoundary, UI components
├── lib/
│   ├── api-spec/            # OpenAPI 3.1 specification
│   ├── api-client-react/    # Generated React Query hooks (Orval)
│   ├── api-zod/             # Generated Zod schemas (Orval)
│   ├── db/                  # Drizzle ORM schema + migrations
│   │   └── src/schema/      # nodes, sites, deployments, federation, auth
│   └── integrations/        # auth-web, object-storage
├── scripts/                 # Seed + utility scripts
├── docs/                    # Architecture, API, Contributing, Security
├── LICENSE
└── README.md
```

---

## Bundled Sites

Two production-ready websites are included in the `sites/` directory. They can be deployed into your node automatically:

```bash
# Start the API server first (creates the local node), then:
pnpm --filter @workspace/scripts run seed:sites
```

| Site | Domain | Description |
|------|--------|-------------|
| **Nexus Hosting** | `nexushosting.app` | Landing page explaining what Nexus Hosting is, for everyday users — not developers. Includes animated network visualisation, live node/site stats, and a guided "how it works" section. |
| **The No Hands Company** | `nohands.company` | Company portfolio — all No Hands Company projects, values, and contact information. |

Both sites are plain HTML/CSS/JS — no build step required. They are stored in `sites/nexushosting-landing/` and `sites/nohands-company/`.

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for how to get started, code style, and the PR process.

---

## Security

See [SECURITY.md](./SECURITY.md) for the vulnerability disclosure policy and security model.

---

## License

[MIT](./LICENSE) — Copyright (c) 2025 The No Hands Company
