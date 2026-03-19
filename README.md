# Federated Hosting

A production-grade **federated website hosting service** where users deploy static sites and independent nodes form a cryptographically verified network. No single company controls the infrastructure — anyone can run a node.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-24-green.svg)](https://nodejs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-blue.svg)](https://www.postgresql.org/)

---

## What is Federated Hosting?

Federated Hosting lets users:

1. **Log in** via Replit Auth (OpenID Connect)
2. **Upload** website files (HTML, CSS, JS, images, fonts) to object storage
3. **Deploy** their site — gets a unique domain, version-tracked, atomically committed
4. **Replicate** — the deploy is automatically mirrored to all active federation peers via signed `site_sync` events
5. **Serve** — any node in the network can serve any site, routed by host header

Independent operators run nodes. Each node has an **Ed25519 cryptographic identity**, participates in the federation protocol, and can host and replicate sites for the network.

---

## Quick Start

### Prerequisites

- [Node.js 24+](https://nodejs.org/)
- [pnpm 10+](https://pnpm.io/)
- PostgreSQL database (connection string in `DATABASE_URL`)
- Replit object storage (or S3-compatible store)

### Install

```bash
git clone https://github.com/The-No-Hands-company/Federated-Hosting.git
cd Federated-Hosting
pnpm install
```

### Environment Variables

```env
DATABASE_URL=postgresql://user:password@host:5432/dbname
DEFAULT_OBJECT_STORAGE_BUCKET_ID=your-bucket-id
PRIVATE_OBJECT_DIR=private
PUBLIC_OBJECT_SEARCH_PATHS=public
NODE_ENV=development
```

### Database Setup

```bash
# Push schema to database (creates all tables and indexes)
pnpm --filter @workspace/db run push
```

### Development

```bash
# Start everything concurrently
pnpm run dev

# Or start individually:
pnpm --filter @workspace/api-server run dev     # API on :8080
pnpm --filter @workspace/federated-hosting run dev  # Frontend on :25231
```

### Build

```bash
pnpm run build
```

---

## Features

### Phase 1 — Auth + File Serving
- Replit Auth (OIDC + PKCE) — users own their sites
- Presigned URL upload flow to object storage
- Host-header site serving — `your-domain.com` routes to the right files
- My Sites dashboard + drag-and-drop deploy UI

### Phase 2 — Federation Protocol
- **Ed25519 key pairs** — each node has a cryptographic identity
- **`/.well-known/federation`** discovery endpoint
- **Signed handshakes** — nodes verify each other's identity before peering
- **Federation event log** — persistent record of all handshakes, pings, syncs
- Deploy → automatic replication to all active peers

### Phase 3 — Subdomain Routing + Replication
- Host-header routing middleware — serves any registered site domain
- Per-node capacity API — storage stats, site counts, bandwidth
- Auto-initialises local node with Ed25519 keys on startup
- Network-wide capacity overview

### Phase 4 — Production Hardening
- Helmet (CSP, HSTS, X-Frame-Options, X-Content-Type-Options)
- Rate limiting — 200 req/min global; 20 req/min on auth/upload
- Gzip compression
- Structured pino logging with request IDs (X-Request-ID)
- `AppError` class + `asyncHandler` — clean error propagation
- Global error handler — structured JSON errors, no stack traces in prod
- DB transactions on deploy — atomic, never partial
- Database indexes on all hot query paths
- Graceful shutdown — drains connections on SIGTERM/SIGINT
- React `ErrorBoundary` — friendly fallback UI on crashes
- Auto-retry with exponential backoff; no retries on 4xx

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
Browser → Federated Hosting UI (Vite/React)
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
│   └── federated-hosting/   # React + Vite frontend
│       └── src/
│           ├── pages/       # Dashboard, MySites, DeploySite, Federation, Nodes, Sites
│           └── components/  # Layout, ErrorBoundary, UI components
├── lib/
│   ├── api-spec/            # OpenAPI 3.1 specification
│   ├── api-client-react/    # Generated React Query hooks (Orval)
│   ├── api-zod/             # Generated Zod schemas (Orval)
│   ├── db/                  # Drizzle ORM schema + migrations
│   │   └── src/schema/      # nodes, sites, deployments, federation, auth
│   └── integrations/        # replit-auth-web, object-storage
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
| **Federated Hosting** | `fedhosting.app` | Landing page explaining what Federated Hosting is, for everyday users — not developers. Includes animated network visualisation, live node/site stats, and a guided "how it works" section. |
| **The No Hands Company** | `nohands.company` | Company portfolio — all No Hands Company projects, values, and contact information. |

Both sites are plain HTML/CSS/JS — no build step required. They are stored in `sites/fedhosting-landing/` and `sites/nohands-company/`.

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for how to get started, code style, and the PR process.

---

## Security

See [SECURITY.md](./SECURITY.md) for the vulnerability disclosure policy and security model.

---

## License

[MIT](./LICENSE) — Copyright (c) 2025 The No Hands Company
