# Architecture

This document describes the system design, data flow, and technical decisions behind Nexus Hosting.

---

## Overview

Nexus Hosting is a **decentralised website hosting network**. It is designed so that:

- Any operator can run an independent **node**
- Nodes peer with each other via a cryptographically verified **federation protocol**
- Users deploy sites to one node; the site is replicated across the network
- Any node can serve any site, routed by the `Host` HTTP header
- No central authority controls which nodes exist or which sites are hosted

The architecture is intentionally simple: a PostgreSQL database, an object store, an Express API, and a React frontend — all running in a monorepo with pnpm workspaces.

---

## System Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser                                                        │
│  ┌──────────────────┐    ┌───────────────────────────────────┐  │
│  │ Federated UI     │    │ Site visitor (any domain)         │  │
│  │ React + Vite     │    │ Host: my-site.example.com         │  │
│  └────────┬─────────┘    └──────────────┬────────────────────┘  │
└───────────┼───────────────────────────  │ ──────────────────────┘
            │ /api/*                      │ host-header
            ▼                             ▼
┌───────────────────────────────────────────────────────────────┐
│  API Server  (Express 5, TypeScript)                          │
│                                                               │
│  Middleware stack:                                            │
│    helmet → rate-limit → X-Request-ID → pino-http            │
│    → compress → CORS → body-parse → authMiddleware            │
│    → hostRouter → routes → errorHandler                       │
│                                                               │
│  Routes:                                                      │
│    /api/auth/*         OIDC Auth OIDC flow                  │
│    /api/nodes/*        Node registry CRUD                     │
│    /api/sites/*        Site management                        │
│    /api/sites/serve/*  File streaming from object storage     │
│    /api/deploy/*       Upload URL, file register, deploy      │
│    /api/federation/*   Protocol endpoints                     │
│    /api/capacity/*     Storage / bandwidth stats              │
│    /api/health/*       Health + liveness + readiness          │
│    /.well-known/       Federation discovery                   │
│                                                               │
└──────────────┬──────────────────────────────┬────────────────┘
               │                              │
               ▼                              ▼
┌──────────────────────┐          ┌──────────────────────────┐
│  PostgreSQL           │          │  Object Storage           │
│  (Drizzle ORM)        │          │  (S3 / MinIO / R2)       │
│                       │          │                          │
│  Tables:              │          │  Buckets:                │
│    users              │          │    private/ (uploads)    │
│    sessions           │          │    public/  (CDN-ready)  │
│    nodes              │          │                          │
│    sites              │          │  Access:                 │
│    site_deployments   │          │    Presigned upload URL  │
│    site_files         │          │    Streaming download    │
│    federation_events  │          └──────────────────────────┘
└──────────────────────┘

                      Federation Network
            ┌──────────────────────────────────┐
            │  This Node  ←──── signed ping ──→ │
            │              ←──── handshake ───→ │
            │              ←──── site_sync ───→ │
            │                                  │
            │  Peer Node A      Peer Node B    │
            │  (independent)    (independent)  │
            └──────────────────────────────────┘
```

---

## Monorepo Structure

The project is a **pnpm workspace monorepo** with TypeScript project references.

| Package | Path | Role |
|---------|------|------|
| `@workspace/api-server` | `artifacts/api-server` | Express API + federation node |
| `@workspace/nexus-hosting` | `artifacts/nexus-hosting` | React + Vite user interface |
| `@workspace/db` | `lib/db` | Drizzle ORM schema + DB connection |
| `@workspace/api-spec` | `lib/api-spec` | OpenAPI 3.1 spec (source of truth) |
| `@workspace/api-zod` | `lib/api-zod` | Auto-generated Zod validators (Orval) |
| `@workspace/api-client-react` | `lib/api-client-react` | Auto-generated React Query hooks (Orval) |
| `@workspace/auth-web` | `lib/integrations/auth-web` | `useAuth()` hook |
| `@workspace/object-storage` | `lib/storageProvider` | Object storage client |

Every package extends `tsconfig.base.json` (`composite: true`). Build order is resolved by TypeScript project references.

---

## Database Schema

```
users
  id            text PK (OIDC subject identifier)
  name          text
  email         text
  profileImage  text
  createdAt     timestamp

sessions
  id            text PK
  userId        text FK → users.id
  data          jsonb
  expiresAt     timestamp

nodes
  id            serial PK
  name          text
  domain        text UNIQUE
  status        enum(active, inactive, maintenance)
  region        text
  publicKey     text  (Ed25519 PEM)
  privateKey    text  (Ed25519 PEM — local node only)
  isLocalNode   int   (1 for this node, 0 for peers)
  maxStorageGb  real
  usedStorageGb real
  siteCount     int
  joinedAt      timestamp
  lastSeenAt    timestamp
  verifiedAt    timestamp

sites
  id            serial PK
  name          text
  domain        text UNIQUE
  description   text
  ownerId       text FK → users.id
  primaryNodeId int  FK → nodes.id
  status        enum(active, suspended, migrating)
  type          enum(static, dynamic, blog, portfolio, other)
  replicaCount  int
  storageUsedMb real
  monthlyBandwidthGb real
  createdAt     timestamp
  updatedAt     timestamp

site_deployments
  id            serial PK
  siteId        int  FK → sites.id
  version       int
  deployedBy    text FK → users.id
  status        enum(pending, active, failed, rolled_back)
  fileCount     int
  totalSizeMb   real
  deployedAt    timestamp
  createdAt     timestamp

site_files
  id            serial PK
  siteId        int  FK → sites.id
  deploymentId  int  FK → site_deployments.id (null = pending)
  filePath      text
  objectPath    text
  contentType   text
  sizeBytes     int
  createdAt     timestamp

federation_events
  id            serial PK
  eventType     enum(handshake, ping, site_sync, node_offline, key_rotation)
  fromNodeDomain text
  toNodeDomain  text
  payload       text (JSON)
  verified      int  (0 or 1)
  createdAt     timestamp
```

### Indexes

| Table | Index | Columns |
|-------|-------|---------|
| `sites` | `sites_owner_idx` | `ownerId` |
| `sites` | `sites_status_idx` | `status` |
| `sites` | `sites_primary_node_idx` | `primaryNodeId` |
| `nodes` | `nodes_status_idx` | `status` |
| `nodes` | `nodes_local_idx` | `isLocalNode` |
| `site_deployments` | `site_deployments_site_idx` | `siteId` |
| `site_deployments` | `site_deployments_status_idx` | `status` |
| `site_files` | `site_files_site_idx` | `siteId` |
| `site_files` | `site_files_path_idx` | `(siteId, filePath)` composite |
| `site_files` | `site_files_deployment_idx` | `deploymentId` |
| `federation_events` | `federation_events_type_idx` | `eventType` |
| `federation_events` | `federation_events_from_idx` | `fromNodeDomain` |
| `federation_events` | `federation_events_created_idx` | `createdAt` |

---

## Request Lifecycle

### Authenticated API request

```
Client
  → [helmet headers]
  → [rate limiter — drops if over limit]
  → [X-Request-ID assigned]
  → [pino-http logs request start]
  → [gzip compress]
  → [CORS check]
  → [body parser]
  → [authMiddleware — reads session cookie, attaches req.user]
  → [hostRouter — if Host header matches a site domain, serve it]
  → [route handler — asyncHandler wraps, throws AppError on problems]
  → [globalErrorHandler — serialises AppError to JSON]
  → [pino-http logs response time + status]
  → Client
```

### File upload + deploy

```
Client
  1. POST /api/sites/:id/files/upload-url
       → server calls storage.getObjectEntityUploadURL()
       → returns { uploadUrl, objectPath }
  
  2. PUT uploadUrl (direct to object storage — bypasses API server)
       → client streams file bytes to storage
  
  3. POST /api/sites/:id/files
       → registers { filePath, objectPath, contentType, sizeBytes } in DB
       → deploymentId = null (pending)
  
  4. POST /api/sites/:id/deploy
       → DB transaction:
           a. count existing deployments → new version = n+1
           b. INSERT site_deployments (status=active)
           c. UPDATE site_files SET deploymentId = newDeployment.id WHERE deploymentId IS NULL
           d. UPDATE sites SET storageUsedMb = total
       → Promise.allSettled: notify all active peers via signed site_sync
       → return deployment + replication results
```

### Host-header site serving

```
Incoming request: GET / with Host: my-blog.example.com

  → hostRouter middleware
  → SELECT sites WHERE domain = 'my-blog.example.com'
  → SELECT site_files WHERE siteId = X AND filePath = 'index.html'
  → storage.downloadObject(file.objectPath)
  → stream response body to client
  → fallback: if path not found, try 'index.html' (SPA support)
```

---

## Federation Protocol

### Node identity

Every node generates an **Ed25519 key pair** on first boot (`crypto.generateKeyPairSync("ed25519")`). The public key is published at `/.well-known/federation`. The private key never leaves the node.

### Handshake

```
Node A                                    Node B
  |                                          |
  |-- GET /.well-known/federation ---------->|
  |<-- { publicKey, capabilities, ... } -----|
  |                                          |
  |-- POST /api/federation/ping ------------>|
  |   { nodeDomain, challenge, signature }   |
  |   signature = Ed25519.sign(              |
  |     privateKeyA,                         |
  |     `${nodeDomain}:${challenge}:${ts}`   |
  |   )                                      |
  |                                          |
  |   [Node B verifies signature with        |
  |    Node A's public key from discovery]   |
  |                                          |
  |<-- { verified: true, challenge } --------|
```

### Site sync

When a site is deployed, all active peers receive:

```http
POST /api/federation/sync
Content-Type: application/json
X-Federation-Signature: <Ed25519 signature>

{ "siteDomain": "my-blog.example.com", "deploymentId": 42 }
```

The peer records the event in `federation_events`. Full file replication (pulling file bytes from the originating node) is on the roadmap.

---

## Security Model

| Concern | Mitigation |
|---------|------------|
| Node impersonation | Ed25519 signature on every ping; `verifiedAt` only set if signature validates |
| Directory traversal | `path.normalize` + strip leading `..` on all file paths |
| XSS | helmet CSP headers; React renders text as text by default |
| Clickjacking | `X-Frame-Options: DENY` via helmet |
| Brute force | 20 req/min on `/api/login`, `/api/callback` |
| Upload abuse | 50 MB per-file, 500 MB per-deploy hard limits |
| Log leakage | pino redacts `privateKey` and `password` fields |
| Partial deploys | DB transaction: all-or-nothing |
| Crashes | `unhandledRejection` + `uncaughtException` handlers; graceful SIGTERM drain |

---

## Scalability Notes

The current implementation is designed for correctness and clarity. For genuinely high-scale operation (1B+ daily users), consider:

- **CDN layer** in front of each node for static file caching
- **Read replicas** for the PostgreSQL database
- **Horizontal API scaling** — the API server is stateless (sessions in DB); run multiple instances behind a load balancer
- **Full peer replication** — currently only metadata is synced on deploy; full file replication would eliminate the need for every node to hit object storage
- **Consistent hashing** for site-to-node assignment
- **Stream uploads** directly from browser to object storage (already implemented via presigned URLs — API server never touches file bytes)

---

## Technology Choices

| Decision | Choice | Reason |
|----------|--------|--------|
| Language | TypeScript 5.9 | Type safety across the full stack; project references for monorepo builds |
| Runtime | Node.js 24 | Native Ed25519 support in `crypto`; native `fetch`; `AbortSignal.timeout` |
| API framework | Express 5 | Stable, well-understood, async error propagation built-in |
| Database ORM | Drizzle | Thin, type-safe, close to SQL; no magic |
| Validation | Zod v4 | Generated from OpenAPI spec via Orval — single source of truth |
| Frontend | React 19 + Vite 7 | Fast HMR; RSC-ready if needed later |
| Crypto | Node built-in `crypto` | No third-party deps for key gen/sign/verify |
| Logging | pino | Fastest JSON logger for Node; redaction built-in |
| Object storage | S3-compatible object storage | S3-compatible; presigned URLs keep file bytes off the API server |
