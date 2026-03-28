# Production Launch Checklist

This checklist is for node operators preparing a Nexus Hosting node for public traffic. Work through every item before announcing your node to the network.

**Scale context:** This software is designed for networks serving 1.5 billion+ users. Every item on this list exists for a reason. Do not skip steps.

---

## Infrastructure

- [ ] **PostgreSQL 15+** — hosted on a managed service (PlanetScale, Neon, Supabase, AWS RDS) or a dedicated VM with daily backups
- [ ] **Object storage** — S3-compatible bucket with versioning enabled (AWS S3, Cloudflare R2, Backblaze B2, or MinIO)
- [ ] **Minimum compute** — 2 vCPU, 2 GB RAM for the API server. Scale horizontally behind a load balancer for high traffic.
- [ ] **Reverse proxy** — Caddy (recommended) or nginx in front of the Node.js process. Never expose Node directly on port 443.
- [ ] **TLS** — valid certificate for your public domain. Caddy handles this automatically. See `docs/SELF_HOSTING.md`.
- [ ] **Firewall** — only ports 80 and 443 open inbound. SSH restricted to known IPs or via bastion.
- [ ] **Non-root process** — API server runs as a non-root user (already configured in the Dockerfile).

---

## Environment Variables

### Required — server will not start without these

- [ ] `DATABASE_URL` — PostgreSQL connection string with a dedicated application user (not superuser)
- [ ] `ISSUER_URL` — OIDC provider issuer URL. **Server throws at startup if missing.** See `docs/SELF_HOSTING.md#auth` for provider setup (Authentik, Keycloak, Auth0).
- [ ] `OIDC_CLIENT_ID` — OIDC client ID. **Server throws at startup if missing.**
- [ ] `COOKIE_SECRET` — Random 32+ char secret for HMAC-signed unlock cookies. **Server throws at startup if missing.** Generate: `openssl rand -hex 32`
- [ ] `OBJECT_STORAGE_ENDPOINT` — S3-compatible endpoint URL (Cloudflare R2, AWS S3, MinIO)
- [ ] `OBJECT_STORAGE_ACCESS_KEY` + `OBJECT_STORAGE_SECRET_KEY` — S3 credentials
- [ ] `DEFAULT_OBJECT_STORAGE_BUCKET_ID` — bucket name for site files (must exist before first boot)
- [ ] `PUBLIC_DOMAIN` — public hostname (e.g. `node.yourdomain.com`) — used in federation discovery and email links

### Required for correct behaviour

- [ ] `NODE_ENV=production` — enables JSON structured logs, disables stack traces in API error responses
- [ ] `REDIS_URL` — Redis connection string. Without this, rate limiting is per-instance in-memory and sessions are not shared across multiple API server instances. A warning is logged at startup.
- [ ] `PRIVATE_OBJECT_DIR` and `PUBLIC_OBJECT_SEARCH_PATHS` — object storage path prefixes

### Node identity (shown publicly in federation directory)

- [ ] `NODE_NAME`, `NODE_REGION`, `OPERATOR_NAME`, `OPERATOR_EMAIL`
- [ ] `STORAGE_CAPACITY_GB`, `BANDWIDTH_CAPACITY_GB` — your advertised limits
- [ ] `ALLOWED_ORIGINS` — restrict to your actual frontend domain(s), not `*`

### Email notifications (strongly recommended)

Without SMTP: invitations, deploy success/fail emails, certificate expiry warnings, and form submission alerts will not send.

- [ ] `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` — any SMTP provider (Resend, Postmark, SES, SendGrid)
- [ ] `EMAIL_FROM` — `noreply@yourdomain.com`

### Security hardening

- [ ] `METRICS_TOKEN` — random string protecting `GET /metrics` from public access. Without this, Prometheus metrics are open to anyone.
- [ ] `ACME_EMAIL` — required if `ACME_ENABLED=true` (Let's Encrypt account email)

### Optional but valuable

- [ ] `ENABLE_SITE_HEALTH_CHECKS=true` — periodic reachability checks on hosted sites
- [ ] `ANALYTICS_RETENTION_DAYS`, `FORM_RETENTION_DAYS`, `AUDIT_LOG_RETENTION_DAYS` — data retention windows

See `.env.example` for every variable with examples and defaults.

---


## Database

- [ ] **Migrations applied** — run `pnpm --filter @workspace/db run migrate` (not `db push`) before first boot
- [ ] **Connection pool** — `DATABASE_URL` uses connection pooling (PgBouncer, or the managed service's built-in pooler)
- [ ] **Backups** — automated daily backups with at least 7-day retention
- [ ] **Read replica** — consider a read replica for analytics queries if traffic is high

---

## Security

- [ ] **Rate limiting** — verify `NODE_ENV=production` is set so rate limits are not in dev-permissive mode
- [ ] **Private key safety** — Ed25519 private keys are stored in the database, encrypted at rest. Confirm your managed DB has encryption at rest enabled.
- [ ] **API token hashing** — tokens are SHA-256 hashed before storage. Never log them.
- [ ] **CORS** — `ALLOWED_ORIGINS` set to your exact frontend domain(s), not `*`
- [ ] **Helmet** — CSP, HSTS, and other security headers are only fully active in `production` mode
- [ ] **Dependency audit** — run `pnpm audit` and resolve critical/high vulnerabilities before launch

---

## Federation

- [ ] **Ed25519 key pair** — auto-generated on first boot. Verify with `GET /.well-known/federation` → `publicKey` should not be null.
- [ ] **Public reachability** — `/.well-known/federation` returns 200 from an external machine
- [ ] **Handshake with at least one peer** — use the Federation Protocol page or `POST /api/federation/handshake`
- [ ] **Gossip pusher running** — check logs for `[gossip] Gossip pusher started`
- [ ] **Health monitor running** — check logs for `[health] Health monitor started`
- [ ] **Conflict resolution** — if you're migrating an existing domain, ensure `joinedAt` timestamps are correct

---

## Monitoring

- [ ] **Health endpoint** — configure uptime monitoring on `GET /api/health/live` (expected: `{"status":"alive"}`)
- [ ] **Readiness endpoint** — `GET /api/health/ready` for Kubernetes/load-balancer health checks
- [ ] **Logs** — JSON logs piped to a log aggregator (Datadog, Grafana Loki, CloudWatch)
- [ ] **Webhook alerts** — `WEBHOOK_URLS` configured to notify your team of `node_offline` and `deploy_failed` events
- [ ] **Disk space** — alert when object storage approaches capacity; monitor `GET /api/capacity/summary`

---

## Performance

- [ ] **Lazy loading** — the frontend uses React lazy() — all page chunks are code-split automatically
- [ ] **Cache headers** — `Cache-Control: public, max-age=3600` is set on all served site files
- [ ] **Compression** — gzip is enabled via the `compression` middleware
- [ ] **Geographic routing** — if you have peers in multiple regions, set `ENABLE_GEO_ROUTING=true` to redirect users to the nearest node
- [ ] **CDN (optional)** — put a CDN (Cloudflare, AWS CloudFront) in front of the reverse proxy for static asset edge caching

---

## Deployment

- [ ] **GitHub Actions** — `FH_NODE_URL`, `FH_TOKEN`, `FH_SITE_ID` secrets set in every repository that deploys to this node
- [ ] **CLI installed** — `npm install -g @nexushosting/cli` on all developer machines
- [ ] **Rollback tested** — do a test deploy, then rollback, verify the previous version serves correctly
- [ ] **Drizzle migrations** — never run `db push` in production; always use `pnpm --filter @workspace/db run migrate`

---

## Go-Live

- [ ] **DNS** — A record (or CNAME) pointing `node.yourdomain.com` at your server's IP
- [ ] **TLS certificate** — valid and auto-renewing
- [ ] **Smoke test** — deploy a real site end-to-end from your machine to the live node
- [ ] **Federation handshake** — verified handshake with the public bootstrap node at `nodes.nexushosting.network`
- [ ] **Announce your node** — submit to the community directory (coming soon)

---

*If you run into issues, open a GitHub issue or check `docs/SELF_HOSTING.md`.*
