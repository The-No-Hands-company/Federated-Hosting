# Self-Hosting Guide

A complete walkthrough for running your own Nexus Hosting node anywhere — a VPS, bare metal, or any Linux host. .

---

## Contents

1. [Prerequisites](#prerequisites)
2. [Quick Start (Docker Compose)](#quick-start-docker-compose)
3. [Manual Setup (Node.js)](#manual-setup-nodejs)
4. [Environment Variables Reference](#environment-variables-reference)
5. [Replacing legacy Services](#replacing-replit-specific-services)
   - [Auth — from your OIDC provider to any OIDC provider](#auth)
   - [Object Storage — from Replit to S3/R2/MinIO](#object-storage)
6. [Reverse Proxy (nginx / Caddy)](#reverse-proxy)
7. [TLS / Let's Encrypt](#tls--lets-encrypt)
8. [Joining the Federation](#joining-the-federation)
9. [Upgrading](#upgrading)
10. [Troubleshooting](#troubleshooting)

---

## Prerequisites

| Dependency | Version | Notes |
|------------|---------|-------|
| Docker + Compose | 24+ | Recommended path |
| **OR** Node.js | 24+ | Manual path |
| **OR** pnpm | 10+ | Manual path |
| PostgreSQL | 15+ | Bundled in Compose, or use any hosted DB |
| S3-compatible store | any | MinIO bundled, or AWS S3 / Cloudflare R2 / Backblaze B2 |
| A public domain | — | Required for federation to work properly |

---

## Quick Start (Docker Compose)

### 1. Clone the repo

```bash
git clone https://github.com/The-No-Hands-company/Nexus-Hosting.git
cd Nexus-Hosting
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your values (see [Environment Variables Reference](#environment-variables-reference)). The minimum required set:

```env
POSTGRES_PASSWORD=choose-a-strong-password
MINIO_ROOT_PASSWORD=choose-a-strong-password
PUBLIC_DOMAIN=node.yourdomain.com
NODE_NAME=My NexusHosting Node
OPERATOR_EMAIL=you@example.com
```

### 3. Start everything

```bash
docker compose up -d
```

This starts:
- **PostgreSQL 16** — database
- **MinIO** — S3-compatible object storage (console at `:9001`)
- **migrate** — one-shot job that pushes the DB schema, then exits
- **app** — the API server + frontend, served on port 8080

### 4. Verify it's running

```bash
curl http://localhost:8080/api/health
```

Expected response:

```json
{ "status": "healthy", ... }
```

### 5. Open the MinIO console

Visit `http://your-server:9001` and log in with `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD`.  
Create a bucket named `nexus-sites` (or whatever you set `OBJECT_STORAGE_BUCKET` to).

---

## Manual Setup (Node.js)

If you prefer to run without Docker:

```bash
# Install pnpm if needed
corepack enable && corepack prepare pnpm@latest --activate

# Install workspace dependencies
pnpm install --frozen-lockfile

# Configure environment
cp .env.example .env
# Edit .env with your DATABASE_URL, storage config, etc.

# Push database schema
pnpm --filter @workspace/db run push

# Build everything
pnpm run build

# Start the server
NODE_ENV=production PORT=8080 node artifacts/api-server/dist/index.js
```

For development (hot-reload):

```bash
pnpm run dev
```

---

## Environment Variables Reference

All required variables must be set before the server will start. Optional variables have safe defaults.

### Core (required)

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string — `postgresql://user:pass@host:5432/db` |
| `ISSUER_URL` | OIDC provider issuer URL — throws at startup if missing. See [Auth setup](#auth) below. |
| `OIDC_CLIENT_ID` | OIDC client ID — throws at startup if missing. |
| `COOKIE_SECRET` | Random 32+ char secret for HMAC-signed unlock cookies. **Throws at startup in production if missing.** Generate with `openssl rand -hex 32` |
| `PUBLIC_DOMAIN` | Public hostname where this node is reachable — e.g. `node.example.com` |
| `OBJECT_STORAGE_ENDPOINT` | S3-compatible endpoint URL — e.g. `https://s3.amazonaws.com`, `http://minio:9000`, `https://<id>.r2.cloudflarestorage.com` |
| `OBJECT_STORAGE_ACCESS_KEY` | S3 access key ID |
| `OBJECT_STORAGE_SECRET_KEY` | S3 secret access key |
| `DEFAULT_OBJECT_STORAGE_BUCKET_ID` | Bucket name for site files |

### Node identity

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_NAME` | `Primary Node` | Display name shown in federation directory |
| `NODE_REGION` | `self-hosted` | Geographic region label (e.g. `ap-southeast-1`) |
| `OPERATOR_NAME` | `Node Operator` | Your name or organisation |
| `OPERATOR_EMAIL` | `admin@example.com` | Contact email shown in federation discovery |
| `STORAGE_CAPACITY_GB` | `100` | Advertised storage capacity |
| `BANDWIDTH_CAPACITY_GB` | `1000` | Advertised bandwidth capacity |

### Server

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | API server listening port |
| `NODE_ENV` | `development` | Set to `production` for JSON structured logs |
| `ALLOWED_ORIGINS` | `*` | Comma-separated allowed CORS origins |
| `PRIVATE_OBJECT_DIR` | `private` | Object storage prefix for private uploads |
| `PUBLIC_OBJECT_SEARCH_PATHS` | `public` | Object storage prefix for public files |

### Redis (strongly recommended in production)

| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_URL` | — | Redis connection URL — `redis://localhost:6379`. Without this, rate limiting is per-instance in-memory and sessions are not shared across instances. A warning is logged in production. |

### Email (optional but highly recommended)

Without SMTP, invitations, deploy notifications, certificate expiry warnings, and form submission alerts will not be sent. Everything else works normally.

| Variable | Default | Description |
|----------|---------|-------------|
| `SMTP_HOST` | — | SMTP server hostname. Leave blank to disable email entirely. |
| `SMTP_PORT` | `587` | SMTP port (use `465` for TLS) |
| `SMTP_SECURE` | `false` | Set to `true` for port 465 TLS |
| `SMTP_USER` | — | SMTP username / login |
| `SMTP_PASS` | — | SMTP password or API key |
| `EMAIL_FROM` | `noreply@<PUBLIC_DOMAIN>` | From address for outgoing mail |
| `EMAIL_FROM_NAME` | `NexusHosting` | From display name |

**Provider examples:**
```bash
# Resend
SMTP_HOST=smtp.resend.com  SMTP_PORT=587  SMTP_USER=resend  SMTP_PASS=re_xxx

# Postmark
SMTP_HOST=smtp.postmarkapp.com  SMTP_PORT=587  SMTP_USER=<server-token>  SMTP_PASS=<server-token>

# AWS SES (us-east-1)
SMTP_HOST=email-smtp.us-east-1.amazonaws.com  SMTP_PORT=587
SMTP_USER=<access-key-id>  SMTP_PASS=<smtp-password>

# SendGrid
SMTP_HOST=smtp.sendgrid.net  SMTP_PORT=587  SMTP_USER=apikey  SMTP_PASS=<api-key>
```

### TLS / ACME (optional — use Caddy instead for most setups)

| Variable | Default | Description |
|----------|---------|-------------|
| `ACME_ENABLED` | `false` | Set to `true` to enable built-in Let's Encrypt provisioning |
| `ACME_EMAIL` | — | Contact email for Let's Encrypt account (required if ACME_ENABLED) |
| `ACME_CERT_DIR` | `/etc/certs` | Directory where certificates are stored |
| `ACME_STAGING` | `false` | Use Let's Encrypt staging (rate-limit free) — set `true` during testing |
| `ACME_CHALLENGE_TYPE` | `http` | `http` for HTTP-01, `dns` for DNS-01 (no port 80 needed) |
| `ACME_DNS_PROPAGATION_WAIT` | `30000` | Milliseconds to wait for DNS-01 propagation |

See [docs/TLS.md](TLS.md) for the full guide including Caddy, certbot, and DNS-01 setup.

### Observability

| Variable | Default | Description |
|----------|---------|-------------|
| `METRICS_TOKEN` | — | Bearer token protecting `GET /metrics`. If unset, metrics are open (bind to localhost recommended). |
| `ENABLE_SITE_HEALTH_CHECKS` | `false` | Set to `true` to check hosted site reachability every 10 minutes |
| `SITE_HEALTH_CHECK_INTERVAL_MS` | `600000` | Health check interval in milliseconds |

### Data retention

| Variable | Default | Description |
|----------|---------|-------------|
| `ANALYTICS_RETENTION_DAYS` | `90` | Delete hourly analytics rows older than this |
| `FORM_RETENTION_DAYS` | `365` | Delete form submissions older than this |
| `AUDIT_LOG_RETENTION_DAYS` | `365` | Delete admin audit log entries older than this |

---

## Auth

NexusHosting uses **OpenID Connect (OIDC)** for authentication. `ISSUER_URL` and `OIDC_CLIENT_ID` are both **required** — the server throws at startup if either is missing.

The OIDC client must support **Authorization Code flow with PKCE** and the `offline_access` scope. Standard compliant providers work without any code changes.

### Option 1 — Authentik (self-hosted, recommended)

```bash
# Install Authentik (Docker)
docker compose -f authentik-docker-compose.yml up -d

# Create an application:
# 1. Applications → Providers → Create → OAuth2/OpenID Provider
# 2. Name: nexushosting
# 3. Client type: Public (PKCE)
# 4. Redirect URIs: https://your-node.example.com/api/auth/callback
# 5. Scopes: openid profile email offline_access
# 6. Note down the Issuer URL and Client ID
```

```env
ISSUER_URL=https://auth.yourdomain.com/application/o/nexushosting/
OIDC_CLIENT_ID=your-client-id-from-authentik
```

### Option 2 — Keycloak (self-hosted)

```bash
# In your Keycloak realm:
# 1. Clients → Create → Client ID: nexushosting
# 2. Client type: Public
# 3. Valid redirect URIs: https://your-node.example.com/api/auth/callback
# 4. Standard flow: Enabled
```

```env
ISSUER_URL=https://auth.yourdomain.com/realms/your-realm
OIDC_CLIENT_ID=nexushosting
```

### Option 3 — Auth0

```bash
# In Auth0 dashboard:
# 1. Applications → Create → Single Page Application
# 2. Allowed Callback URLs: https://your-node.example.com/api/auth/callback
# 3. Allowed Web Origins: https://your-node.example.com
```

```env
ISSUER_URL=https://your-tenant.us.auth0.com/
OIDC_CLIENT_ID=your-auth0-client-id
```

### Option 4 — Any standards-compliant provider

Any provider with a `/.well-known/openid-configuration` discovery document works: Dex, Okta, Azure AD, Google, GitHub (via an OIDC proxy like Dex), Zitadel, etc.

The redirect URI to register is always: `https://<PUBLIC_DOMAIN>/api/auth/callback`



### Object Storage

The `lib/storageProvider` package wraps S3-compatible object storage. To replace with S3-compatible storage:

1. Set the S3 environment variables:
   ```env
   OBJECT_STORAGE_ENDPOINT=https://s3.amazonaws.com  # or R2/MinIO endpoint
   OBJECT_STORAGE_ACCESS_KEY=AKIAIOSFODNN7EXAMPLE
   OBJECT_STORAGE_SECRET_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
   DEFAULT_OBJECT_STORAGE_BUCKET_ID=my-nexus-bucket
   ```

2. Storage is handled by `artifacts/api-server/src/lib/storageProvider.ts`. Set `OBJECT_STORAGE_ENDPOINT` to activate the S3 provider:
   ```bash
   pnpm --filter @workspace/api-server add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
   ```
   Then rewrite `objectStorage.ts` to use `S3Client` + `getSignedUrl` — the interface (presigned upload URL, presigned download URL) stays the same.

The bundled **MinIO** service in `docker-compose.yml` is already S3-compatible and requires no code changes — just point the env vars at it.

---

## Reverse Proxy

### Caddy (recommended — automatic HTTPS)

```caddyfile
node.yourdomain.com {
    reverse_proxy localhost:8080
}
```

That's it. Caddy handles TLS via Let's Encrypt automatically.

### nginx

```nginx
server {
    listen 80;
    server_name node.yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name node.yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/node.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/node.yourdomain.com/privkey.pem;

    location / {
        proxy_pass         http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade           $http_upgrade;
        proxy_set_header   Connection        "upgrade";
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
        client_max_body_size 600M;
    }
}
```

---

## TLS / Let's Encrypt

With Caddy: automatic, no setup required.

With nginx + Certbot:

```bash
apt install certbot python3-certbot-nginx
certbot --nginx -d node.yourdomain.com
```

---

## Joining the Federation

Once your node is running at a public domain, you need peers to federate with.

### Automatic bootstrap (recommended)

Set `BOOTSTRAP_URLS` in your `.env` to a comma-separated list of bootstrap endpoints. On startup, your node will fetch peer lists from these URLs and register any new nodes automatically. After the initial seed, gossip handles ongoing discovery.

```env
# .env
BOOTSTRAP_URLS=https://bootstrap.nexushosting.network/api/federation/bootstrap
```

Multiple bootstrap nodes for redundancy:
```env
BOOTSTRAP_URLS=https://bootstrap1.example.com/api/federation/bootstrap,https://bootstrap2.example.com/api/federation/bootstrap
```

The bootstrap URL is just any running NexusHosting node's `/api/federation/bootstrap` endpoint. You can use any node operator willing to act as a seed for new nodes.

**After setting BOOTSTRAP_URLS**, restart your node and check the logs:
```bash
docker compose restart app
docker compose logs app | grep bootstrap
# [bootstrap] Seeded peer from bootstrap: domain=peer.example.com
# [bootstrap] Seed complete — added 3 new peer(s)
```

### Manual handshake (UI)

1. Open the **Federation Protocol** page in your node's UI
2. Click **Initiate Handshake** and enter a known peer's domain
3. The remote node verifies your Ed25519 signature and registers you as a peer
4. Your sites now replicate to verified peers on every deploy

### Manual handshake (API)

```bash
curl -X POST https://your-node.example.com/api/federation/handshake \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-admin-token>" \
  -d '{"targetNodeUrl": "https://peer.example.com"}'
```

### Running your own bootstrap node

Any NexusHosting node can serve as a bootstrap node — the endpoint is always available at `GET /api/federation/bootstrap`. To make your node discoverable, simply share your `/api/federation/bootstrap` URL with other operators.

There is no central authority or required registration. The network is as decentralised as its operators choose to make it.

### Trust levels

Federation peers start as `unverified`. They automatically promote to:
- **verified** — after the first successful Ed25519 handshake
- **trusted** — after 50 consecutive successful pings (~4 days of normal operation)

You can manually override trust levels in **Admin → Moderation → Node Trust Scores**. Setting a node to `blocked` defederates it — equivalent to adding it to the federation blocklist.

To register with the public bootstrap node (if one exists for your deployment):

```bash
curl -X POST https://your-node.example.com/api/federation/handshake \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <admin-token>" \
  -d '{"targetNodeUrl": "https://bootstrap.nexushosting.network"}'
```

---

## Upgrading

See **[docs/UPGRADE.md](./UPGRADE.md)** for the full upgrade runbook, including:
- Zero-downtime rolling upgrades (2+ instances)
- How to verify schema version before and after
- Rollback procedure
- New required environment variables per release

Quick version for single-instance setups:

```bash
git pull origin main
docker compose pull
docker compose run --rm migrate   # always run migrations first
docker compose up -d --force-recreate app proxy
```

---

## Troubleshooting

**DB migration fails**
Check that PostgreSQL is healthy: `docker compose ps db`  
Confirm `DATABASE_URL` is correct in `.env`.

**Object storage errors**
Ensure the MinIO bucket exists. Log into the console at `:9001` and create `nexus-sites`.

**Node not reachable from federation peers**
Confirm `PUBLIC_DOMAIN` is set to the public hostname (not `localhost`).  
Check your firewall allows inbound TCP 443 (or 8080 if no reverse proxy).

**Authentication failing**
For OIDC Auth: ensure `OIDC_CLIENT_ID` matches your provider's client ID.  
For custom OIDC: verify the issuer discovery URL returns a valid OIDC configuration at `/.well-known/openid-configuration`.

**Logs**
```bash
docker compose logs -f app       # live app logs
docker compose logs db           # postgres logs
docker compose logs minio        # object storage logs
```

## Low-Resource Mode (Raspberry Pi / Volunteer Nodes)

NexusHosting can run on constrained hardware common in volunteer-operated community nodes — Raspberry Pi 3/4, old laptops, or small cloud VMs (512 MB–1 GB RAM). Set `LOW_RESOURCE=true` in your `.env` to activate a profile tuned for these environments.

```bash
LOW_RESOURCE=true
```

**What changes:**

| Setting | Normal | Low-resource |
|---|---|---|
| DB pool connections | 20 | 5 |
| Domain LRU cache | 10 000 entries | 500 entries |
| File LRU cache | 50 000 entries | 2 000 entries |
| Analytics flush interval | 1 minute | 5 minutes |
| Node health check interval | 2 minutes | 10 minutes |
| Log level | info | warn |
| Global rate limit | 300 req/min | 60 req/min |
| Response compression | level 6 | level 1 (fastest) |

**What does NOT change:**
- All API routes remain fully available
- Federation protocol is identical — low-resource nodes federate normally
- ACME/TLS still works
- Redis integration still works if `REDIS_URL` is set
- Auth is unchanged

**Expected capacity on a Raspberry Pi 4 (4 GB) with `LOW_RESOURCE=true`:**
- ~50 concurrent static site requests
- ~5–10 small static sites with light traffic
- Full federation participant (handshakes, gossip, sync)

**Tips for constrained nodes:**
- Use Caddy as the reverse proxy — it uses less RAM than nginx
- Set `REDIS_URL` pointing at a small Redis instance to share rate limiting
- Consider `DYNAMIC_PORT_START` / `DYNAMIC_PORT_END` range of just 10–20 ports if you don't host dynamic sites
- Use an external managed PostgreSQL (Neon free tier works) to avoid running Postgres on the same Pi

---

## Moderation & Content Safety

### Content Scanning

By default, NexusHosting accepts all uploaded files without scanning. For public-facing nodes, configuring an external content scanner is strongly recommended.

Set `CONTENT_SCAN_WEBHOOK_URL` to enable scanning on every deployment:

```env
# .env
CONTENT_SCAN_WEBHOOK_URL=http://clamav-rest:9000/scan
CONTENT_SCAN_FAIL_CLOSED=false   # true = block deploy if scanner is unreachable
```

NexusHosting POSTs deployment metadata to this URL and expects `{ "safe": true }` or `{ "safe": false, "reason": "..." }` in response.

**Example integrations:**

| Scanner | URL format | Notes |
|---|---|---|
| [clamav-rest](https://github.com/benzino77/clamav-rest) | `http://clamav-rest:9000/scan` | Run as a sidecar container |
| Custom blocklist | Any HTTP endpoint | Write your own policy service |
| VirusTotal | Requires API wrapper | Rate-limited on free tier |

**Docker Compose example (ClamAV sidecar):**

```yaml
services:
  clamav-rest:
    image: benzino77/clamav-rest
    environment:
      APP_MAX_FILE_SIZE: 104857600  # 100 MB
    restart: unless-stopped
    networks:
      - nexus

  app:
    environment:
      CONTENT_SCAN_WEBHOOK_URL: http://clamav-rest:9000/scan
      CONTENT_SCAN_FAIL_CLOSED: "false"
```

If `CONTENT_SCAN_WEBHOOK_URL` is not set, no scanning occurs. No blocking, no errors — just no scanning.

### Abuse Reports

Users and site visitors can submit abuse reports via the **Report abuse** button on site cards, or directly via `POST /api/abuse/report`.

Node operators review reports in **Admin → Moderation**. Actions available:
- **Mark reviewing** — flags as under investigation
- **No action** — closes the report without action
- **Takedown site** — suspends the site immediately and records in the audit log

Reports are stored in the `abuse_reports` table with full history.

### IP Banning

Ban specific IPs or subnets from the **Admin → Moderation → IP Bans** panel, or via the API:

```bash
# Ban a single IP
curl -X POST https://your-node/api/admin/ip-bans \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"ipAddress": "1.2.3.4", "reason": "Spam", "scope": "all"}'

# Ban a subnet (CIDR)
curl -X POST https://your-node/api/admin/ip-bans \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"ipAddress": "1.2.3.4", "cidrRange": "1.2.3.0/24", "reason": "Spam network", "scope": "all"}'

# Temporary ban (expires in 24 hours)
curl -X POST https://your-node/api/admin/ip-bans \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"ipAddress": "1.2.3.4", "scope": "api", "expiresAt": "2026-12-31T00:00:00Z"}'
```

**Scope options:**
- `api` — blocks the IP from using the API (login, deploy, etc.)
- `sites` — blocks the IP from viewing hosted sites
- `all` — blocks everything

Bans are cached in memory for 60 seconds. They take effect immediately for new requests after the cache expires.

### User Management

Suspend abusive users without deleting their data via **Admin → Users → ⋯ → Suspend user**. Suspended users:
- Cannot log in (OIDC callback redirects to `/?error=account_suspended`)
- Cannot make any API requests (403 `ACCOUNT_SUSPENDED`)
- Their sites remain in place (suspend the sites separately if needed)

Set a per-user storage cap to prevent one user filling the node:

```bash
curl -X PATCH https://your-node/api/admin/users/<user-id>/storage-cap \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"storageCapMb": 2048}'   # 2 GB cap; 0 = unlimited
```

This is an operator administration tool — **not a pricing tier**. NexusHosting is free for everyone, always.
