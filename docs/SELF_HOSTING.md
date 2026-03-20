# Self-Hosting Guide

A complete walkthrough for running your own Federated Hosting node anywhere — a VPS, bare metal, or any Linux host. .

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
git clone https://github.com/The-No-Hands-company/Federated-Hosting.git
cd Federated-Hosting
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
NODE_NAME=My FedHost Node
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
Create a bucket named `fedhost-sites` (or whatever you set `OBJECT_STORAGE_BUCKET` to).

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

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | ✅ | — | PostgreSQL connection string |
| `PORT` | — | `8080` | API server port |
| `NODE_ENV` | — | `development` | Set to `production` for JSON logs |
| `PUBLIC_DOMAIN` | ✅ | — | Public hostname (e.g. `node.example.com`) — used as `PUBLIC_DOMAIN` |
| `NODE_NAME` | — | `Primary Node` | Display name for your node |
| `NODE_REGION` | — | `self-hosted` | Geographic region label |
| `OPERATOR_EMAIL` | — | `admin@example.com` | Contact email shown in federation discovery |
| `STORAGE_CAPACITY_GB` | — | `100` | Advertised storage capacity |
| `BANDWIDTH_CAPACITY_GB` | — | `1000` | Advertised bandwidth capacity |
| `DEFAULT_OBJECT_STORAGE_BUCKET_ID` | ✅ | — | Bucket name for site files |
| `PRIVATE_OBJECT_DIR` | ✅ | `private` | Object path prefix for private uploads |
| `PUBLIC_OBJECT_SEARCH_PATHS` | ✅ | `public` | Object path prefix for public files |
| `OBJECT_STORAGE_ENDPOINT` | — | Replit | S3-compatible endpoint URL |
| `OBJECT_STORAGE_ACCESS_KEY` | — | — | S3 access key |
| `OBJECT_STORAGE_SECRET_KEY` | — | — | S3 secret key |
| `ISSUER_URL` | — | — | OIDC issuer URL (required) |
| `OIDC_CLIENT_ID` | ✅ for OIDC Auth | — | OIDC client ID |
| `ALLOWED_ORIGINS` | — | `*` | Comma-separated allowed CORS origins |

---

## Replacing legacy Services

The codebase was originally built . Every legacy integration is isolated and swappable.

### Auth

OIDC Auth uses standard **OpenID Connect (OIDC)**. To replace it:

1. Set up any OIDC provider (Keycloak, Auth0, Okta, Authentik, etc.)
2. Update two env vars:
   ```env
   ISSUER_URL=https://auth.yourdomain.com/realms/fedhost
   OIDC_CLIENT_ID=your-oidc-client-id
   ```
3. The `artifacts/api-server/src/lib/auth.ts` file does standard OIDC discovery — no code change needed as long as your provider supports PKCE + `offline_access`.

For a self-contained option, **Authentik** or **Keycloak** both work out of the box.

### Object Storage

The `lib/storageProvider` package wraps S3-compatible object storage. To replace with S3-compatible storage:

1. Set the S3 environment variables:
   ```env
   OBJECT_STORAGE_ENDPOINT=https://s3.amazonaws.com  # or R2/MinIO endpoint
   OBJECT_STORAGE_ACCESS_KEY=AKIAIOSFODNN7EXAMPLE
   OBJECT_STORAGE_SECRET_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
   DEFAULT_OBJECT_STORAGE_BUCKET_ID=my-fedhost-bucket
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

Once your node is running at a public domain:

1. Open the **Federation Protocol** page in your node's UI
2. Click **Initiate Handshake** and enter another node's domain (e.g. `nodes.fedhosting.network`)
3. The remote node will verify your Ed25519 signature and register you as a peer
4. Your sites will now automatically replicate to verified peers on every deploy

To register with the public bootstrap node:

```bash
curl -X POST https://nodes.fedhosting.network/api/federation/handshake \
  -H "Content-Type: application/json" \
  -d '{"domain": "node.yourdomain.com"}'
```

---

## Upgrading

```bash
# Pull latest code
git pull origin main

# Rebuild containers
docker compose build

# Apply any DB schema changes
docker compose run --rm migrate

# Restart the app
docker compose up -d app
```

---

## Troubleshooting

**DB migration fails**
Check that PostgreSQL is healthy: `docker compose ps db`  
Confirm `DATABASE_URL` is correct in `.env`.

**Object storage errors**
Ensure the MinIO bucket exists. Log into the console at `:9001` and create `fedhost-sites`.

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
