# API Reference

**Base URL:** `/api`  
**Auth:** Session cookie (`sid`) for browser flows · Bearer API token (`Authorization: Bearer fh_<token>`) for CLI/CI  
**Spec:** [`lib/api-spec/openapi.yaml`](../lib/api-spec/openapi.yaml) — validated in CI via Redocly

All list endpoints return `{ data: [...], meta: { total, page, limit, totalPages, hasNextPage, hasPrevPage } }`.  
All error responses return `{ message: string, code: string, status: number }`.

---

## Health

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Full health check (DB latency, version, uptime) |
| GET | `/health/live` | Kubernetes liveness probe |
| GET | `/health/ready` | Kubernetes readiness probe |

---

## Auth

| Method | Path | Description |
|--------|------|-------------|
| GET | `/auth/user` | Currently authenticated user (null if not logged in) |
| GET | `/login` | Start browser OIDC login flow |
| GET | `/callback` | OIDC callback handler |
| GET | `/logout` | Clear session + OIDC logout |
| POST | `/mobile-auth/token-exchange` | Exchange OIDC code for session token (mobile) |
| POST | `/mobile-auth/logout` | Revoke mobile session |

---

## API Tokens

Long-lived tokens for CLI and CI. Created via the UI (My Sites → API Tokens) or API.  
Tokens start with `fh_` and are SHA-256 hashed before storage — plaintext shown once at creation.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/tokens` | ✅ | List active tokens (no hashes) |
| POST | `/tokens` | ✅ | Create token — returns plaintext once |
| DELETE | `/tokens/:id` | ✅ | Revoke a token |

**Request body (POST /tokens):**
```json
{ "name": "laptop-ci", "expiresInDays": 365 }
```

---

## Nodes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/nodes` | List all nodes (paginated, `?page=1&limit=20`) |
| POST | `/nodes` | Register a new node |
| GET | `/nodes/:id` | Get node by ID |
| PATCH | `/nodes/:id` | Update node metadata |
| DELETE | `/nodes/:id` | Remove node from federation |
| POST | `/nodes/:id/generate-keys` | Generate/rotate Ed25519 key pair |
| GET | `/nodes/:id/capacity` | Per-node storage/bandwidth stats |

---

## Sites

| Method | Path | Description |
|--------|------|-------------|
| GET | `/sites` | List sites (paginated, `?search=`, `?status=`, `?ownerId=`) |
| POST | `/sites` | Register a new site |
| GET | `/sites/:id` | Get site by ID |
| PATCH | `/sites/:id` | Update site metadata |
| DELETE | `/sites/:id` | Delete site and all files |

---

## Deployment

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/sites/:id/files/upload-url` | ✅ | Get presigned URL for direct file upload |
| GET | `/sites/:id/files` | | List all files for a site |
| POST | `/sites/:id/files` | ✅ | Register an uploaded file |
| POST | `/sites/:id/deploy` | ✅ | Atomically deploy + replicate to peers |
| GET | `/sites/:id/deployments` | | Deployment history |
| POST | `/sites/:id/deployments/:depId/rollback` | ✅ | Roll back to a previous version |

**Deploy response includes replication results:**
```json
{
  "id": 42, "version": 3, "status": "active",
  "replication": { "peers": 3, "synced": 3, "results": [...] }
}
```

**Rollback** creates a new deployment pointing to the old files — history is always preserved.

---

## Access Control

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/sites/:id/members` | ✅ | List team members |
| POST | `/sites/:id/members` | ✅ | Add a user (owner only) |
| PATCH | `/sites/:id/members/:memberId` | ✅ | Update member role |
| DELETE | `/sites/:id/members/:memberId` | ✅ | Remove member |
| PATCH | `/sites/:id/visibility` | ✅ | Set visibility: `public` / `private` / `password` |
| POST | `/sites/:id/unlock` | | Verify password, set unlock cookie |

**Visibility body:**
```json
{ "visibility": "password", "password": "my-secret-pass" }
```

---

## Custom Domains

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/sites/:id/domains` | ✅ | List custom domains for a site |
| POST | `/sites/:id/domains` | ✅ | Add a domain — returns DNS instructions |
| POST | `/domains/:id/verify` | ✅ | Trigger DNS TXT verification check |
| DELETE | `/domains/:id` | ✅ | Remove a custom domain |

**Add domain response includes instructions:**
```json
{
  "instructions": {
    "txt": { "name": "_fh-verify.yourdomain.com", "type": "TXT", "value": "fhv_abc123..." },
    "cname": { "name": "yourdomain.com", "type": "CNAME", "value": "nodes.nexushosting.network" }
  }
}
```

---

## Analytics

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/sites/:id/analytics` | | Per-site analytics (`?period=24h\|7d\|30d`) |
| GET | `/admin/analytics` | ✅ | Network-wide analytics aggregate |

Analytics are buffered in `analytics_buffer` and flushed into hourly rollups every 60 seconds by a background job.

---

## Admin (Node Operator)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/admin/overview` | ✅ | Full operator dashboard (stats, system info, events) |
| PATCH | `/admin/node` | ✅ | Update local node settings |
| GET | `/admin/users` | ✅ | List all registered users (paginated) |
| GET | `/admin/sites` | ✅ | List all sites with owner info (paginated) |

---

## Capacity

| Method | Path | Description |
|--------|------|-------------|
| GET | `/capacity/summary` | Network-wide storage + bandwidth summary |
| GET | `/nodes/:id/capacity` | Per-node capacity stats |

---

## Federation Protocol

| Method | Path | Description |
|--------|------|-------------|
| GET | `/federation/meta` | Local node metadata + public key |
| POST | `/federation/handshake` | Initiate signed handshake with remote node |
| POST | `/federation/ping` | Receive signed ping from remote node |
| POST | `/federation/sync` | Receive site_sync — pull files and create replica deployment |
| GET | `/federation/manifest/:domain` | Signed file manifest with presigned download URLs |
| GET | `/federation/peers` | Known peers (paginated) |
| GET | `/federation/events` | Event log (paginated, newest first) |

All inter-node messages include an `X-Federation-Signature` header (Ed25519 over the request body).

---

## Gossip / Peer Discovery

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/federation/gossip` | | This node's known peer list |
| POST | `/federation/gossip/push` | | Receive a peer list from a remote node |
| POST | `/federation/gossip/discover` | ✅ | Manually trigger a full discover cycle |
| GET | `/federation/bootstrap` | | Public bootstrap registry (healthy verified peers) |

Gossip push runs every 5 minutes in the background. New nodes can bootstrap by fetching `/federation/bootstrap` from any known node.

---

## Stats

| Method | Path | Description |
|--------|------|-------------|
| GET | `/stats` | Network-wide federation statistics |
| GET | `/stats/hourly` | 24-hour activity breakdown (deployments + events per hour) |

---

## Federation Discovery (well-known)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/.well-known/federation` | Public node discovery — protocol, public key, capabilities |

This endpoint is outside the `/api` prefix and is used by peer nodes during handshake.
