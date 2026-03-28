# Deployment Guide

Complete reference for running a Nexus Hosting node in production. For a quick start with Docker Compose, see [SELF_HOSTING.md](SELF_HOSTING.md).

---

## Requirements

| Dependency | Minimum version | Notes |
|------------|----------------|-------|
| Node.js | 24 | Native Ed25519, native fetch |
| pnpm | 10 | Monorepo workspace manager |
| PostgreSQL | 15 | Any hosted provider works |
| Redis | 7 | Strongly recommended — session sharing, rate limiting |
| S3-compatible storage | — | AWS S3, Cloudflare R2, Backblaze B2, MinIO |
| OIDC provider | — | Authentik, Keycloak, Auth0, Dex, or any standards-compliant provider |

---

## Quick checklist before going live

1. **OIDC provider** configured and `ISSUER_URL` + `OIDC_CLIENT_ID` set
2. **`COOKIE_SECRET`** set to a random 32+ char string (`openssl rand -hex 32`)
3. **Object storage** bucket created and S3 credentials set
4. **PostgreSQL** migrations applied (`pnpm --filter @workspace/db run migrate`)
5. **TLS** terminated by Caddy or nginx (see [TLS.md](TLS.md))
6. **Redis** running and `REDIS_URL` set
7. **`PUBLIC_DOMAIN`** matches your actual public hostname

---

## Environment Variables

### Required — server will not start without these

| Variable | Example | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql://app:pass@db:5432/nexus` | PostgreSQL connection string |
| `ISSUER_URL` | `https://auth.example.com/application/o/nexushosting/` | OIDC provider issuer URL |
| `OIDC_CLIENT_ID` | `nexus-client-id` | OIDC client ID |
| `COOKIE_SECRET` | `(openssl rand -hex 32)` | HMAC signing secret for unlock cookies |
| `PUBLIC_DOMAIN` | `node.example.com` | Public hostname of this node |
| `OBJECT_STORAGE_ENDPOINT` | `https://s3.amazonaws.com` | S3-compatible endpoint |
| `OBJECT_STORAGE_ACCESS_KEY` | `AKIAIOSFODNN7EXAMPLE` | S3 access key ID |
| `OBJECT_STORAGE_SECRET_KEY` | `wJalrXUtnFEMI...` | S3 secret access key |
| `DEFAULT_OBJECT_STORAGE_BUCKET_ID` | `nexus-sites` | Bucket for site files |

### Strongly recommended

| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_URL` | — | `redis://host:6379` — shared sessions + rate limiting |
| `NODE_ENV` | `development` | Set to `production` for JSON logs |
| `ALLOWED_ORIGINS` | `*` | Comma-separated allowed CORS origins |

### Node identity

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_NAME` | `Primary Node` | Display name in federation directory |
| `NODE_REGION` | `self-hosted` | Geographic region (e.g. `ap-southeast-3`) |
| `OPERATOR_NAME` | `Node Operator` | Your name or organisation |
| `OPERATOR_EMAIL` | `admin@example.com` | Contact email |
| `STORAGE_CAPACITY_GB` | `100` | Advertised storage limit |
| `BANDWIDTH_CAPACITY_GB` | `1000` | Advertised bandwidth limit |

### Email notifications

| Variable | Default | Description |
|----------|---------|-------------|
| `SMTP_HOST` | — | SMTP hostname (leave blank to disable email) |
| `SMTP_PORT` | `587` | SMTP port |
| `SMTP_SECURE` | `false` | `true` for port 465 TLS |
| `SMTP_USER` | — | SMTP username |
| `SMTP_PASS` | — | SMTP password / API key |
| `EMAIL_FROM` | `noreply@<PUBLIC_DOMAIN>` | From address |
| `EMAIL_FROM_NAME` | `NexusHosting` | From display name |

### TLS / ACME

| Variable | Default | Description |
|----------|---------|-------------|
| `ACME_ENABLED` | `false` | Enable built-in Let's Encrypt |
| `ACME_EMAIL` | — | Let's Encrypt account email |
| `ACME_CERT_DIR` | `/etc/certs` | Certificate storage directory |
| `ACME_STAGING` | `false` | Use staging CA (testing only) |
| `ACME_CHALLENGE_TYPE` | `http` | `http` or `dns` |

See [TLS.md](TLS.md) for full setup including Caddy (recommended), certbot, and DNS-01.

### Observability

| Variable | Default | Description |
|----------|---------|-------------|
| `METRICS_TOKEN` | — | Bearer token for `GET /metrics` scrape endpoint |
| `ENABLE_SITE_HEALTH_CHECKS` | `false` | Periodic hosted-site reachability checks |
| `SITE_HEALTH_CHECK_INTERVAL_MS` | `600000` | Health check frequency (ms) |

### Data retention

| Variable | Default | Description |
|----------|---------|-------------|
| `ANALYTICS_RETENTION_DAYS` | `90` | Prune hourly analytics older than N days |
| `FORM_RETENTION_DAYS` | `365` | Prune form submissions older than N days |
| `AUDIT_LOG_RETENTION_DAYS` | `365` | Prune audit log entries older than N days |

---

## Initial setup

### 1. Install dependencies

```bash
pnpm install --frozen-lockfile
```

### 2. Apply database migrations

```bash
pnpm --filter @workspace/db run migrate
```

This runs all `.sql` files in `lib/db/migrations/` in order, tracking applied migrations in a `_migrations` table. Safe to re-run.

### 3. Build the applications

```bash
pnpm --filter @workspace/nexus-hosting run build
pnpm --filter @workspace/api-server run build
```

### 4. Start the server

```bash
cd artifacts/api-server
node dist/index.js
```

Or via Docker Compose (recommended):

```bash
docker compose up -d
```

---

## Docker Compose

The included `docker-compose.yml` starts:
- **app** — API server on port 8080
- **db** — PostgreSQL 15
- **migrate** — runs migrations on startup, then exits
- **minio** — S3-compatible object storage (console at `:9001`)
- **redis** — Redis 7

A `docker-compose.override.yml` template is provided for adding a Caddy TLS terminator.

```bash
cp docker-compose.override.yml.example docker-compose.override.yml
# Edit Caddyfile with your domain
docker compose up -d
```

---

## Health checks

| Endpoint | Auth | Description |
|----------|------|-------------|
| `GET /api/health/live` | None | Liveness — returns 200 if process is up |
| `GET /api/health/ready` | None | Readiness — checks DB + Redis connectivity and latency |
| `GET /metrics` | Bearer token | Prometheus metrics (13 gauges, counters, histograms) |

---

## Monitoring

A pre-built Grafana dashboard is at `docs/grafana-dashboard.json`. Import it into Grafana and point it at your Prometheus scrape target (`GET /metrics` with `Authorization: Bearer <METRICS_TOKEN>`).

---

## Upgrading

```bash
git pull origin main
pnpm install --frozen-lockfile
pnpm --filter @workspace/db run migrate   # apply new migrations
docker compose up -d --build              # rebuild and restart
```

Migrations are incremental and idempotent — already-applied files are skipped.

---

## Troubleshooting

**Server won't start:**
- Missing `ISSUER_URL` or `OIDC_CLIENT_ID` → check `.env`
- Missing `COOKIE_SECRET` in production → `export COOKIE_SECRET=$(openssl rand -hex 32)`
- Missing `DATABASE_URL` → check connection string and that PostgreSQL is reachable

**Authentication broken:**
- Verify OIDC redirect URI is registered: `https://<PUBLIC_DOMAIN>/api/auth/callback`
- Check `ISSUER_URL` ends with `/` if required by your provider
- Verify `/.well-known/openid-configuration` is reachable from the server

**Object storage errors:**
- Check bucket exists with correct name
- Verify credentials have `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` permissions
- For MinIO: bucket must be created manually in the console at `:9001`

**Rate limiting not shared across instances:**
- `REDIS_URL` is not set — sessions and rate limits are in-memory per process
- Add Redis and set `REDIS_URL=redis://your-redis:6379`

**Emails not sending:**
- `SMTP_HOST` is not set — email is disabled
- Check SMTP credentials with `curl -v smtp://host:587 --user user:pass`
