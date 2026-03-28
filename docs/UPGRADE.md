# NexusHosting Upgrade Runbook

How to safely upgrade a running NexusHosting node to a new version without data loss.

---

## Before You Start

1. **Read the CHANGELOG** for the new version — look for breaking changes, new required env vars, and schema changes.
2. **Back up your database**: `pg_dump $DATABASE_URL > backup-$(date +%Y%m%d-%H%M%S).sql`
3. **Back up your `.env` file**: `cp .env .env.backup`
4. Confirm you have rollback access (the backup you just made + the old Docker image tag).

---

## Standard Upgrade (Docker Compose)

```bash
# 1. Pull the new code
git fetch origin
git pull origin main

# 2. Pull new Docker images
docker compose pull

# 3. Run migrations BEFORE starting the new app
docker compose run --rm migrate

# 4. Restart the app (zero-downtime with 2+ instances — see below)
docker compose up -d --force-recreate app

# 5. Verify health
curl http://localhost:8080/api/health/live
curl http://localhost:8080/api/health/ready

# 6. Restart the Rust proxy if it changed
docker compose up -d --force-recreate proxy
```

---

## Zero-Downtime Upgrade (2+ app instances behind load balancer)

```bash
# 1. Pull and migrate (same as above)
git pull origin main
docker compose pull
docker compose run --rm migrate

# 2. Roll instances one at a time (replace 'app_1', 'app_2' with your instance names)
docker compose up -d --no-deps --scale app=2 app
# Wait for health checks to pass on new instance
# Remove old instance
docker compose up -d --no-deps --scale app=1 app

# 3. Verify federation still works
curl http://localhost:8080/api/federation/peers | jq .meta.total
```

---

## Checking Current Schema Version

NexusHosting uses a single cumulative migration file (`0000_initial_schema.sql`). All statements use `IF NOT EXISTS` / `IF NOT EXISTS` so they are safe to re-run. To verify what's in your database:

```bash
# Check if a specific table exists
psql $DATABASE_URL -c "\dt" | grep node_trust
psql $DATABASE_URL -c "\dt" | grep abuse_reports
psql $DATABASE_URL -c "\dt" | grep email_verification_tokens

# Check if a specific column exists
psql $DATABASE_URL -c "\d users" | grep email_verified
psql $DATABASE_URL -c "\d users" | grep storage_cap_mb
```

If a table or column is missing, it means the migration hasn't been applied. Run:

```bash
docker compose run --rm migrate
```

---

## What the Migration Does

The migration file (`lib/db/migrations/0000_initial_schema.sql`) is **fully idempotent** — every statement uses `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, and `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`. This means:

- Running it on a database that's already up to date is safe — no errors, no changes.
- Running it on a fresh database creates everything from scratch.
- Running it on an older database adds only the new columns and tables.

You can always safely run the migration. It will never drop data.

---

## Rollback Procedure

### If the app crashes after upgrade:

```bash
# 1. Revert to previous image tag
docker compose down app
# Edit docker-compose.yml: change image tag to previous version
docker compose up -d app

# 2. The database schema is forward-compatible — no need to reverse migrations
#    (IF NOT EXISTS means new columns just exist but old code ignores them)
```

### If you need to fully revert including schema:

```bash
# Restore from backup (this is destructive — all data since backup is lost)
psql $DATABASE_URL < backup-YYYYMMDD-HHMMSS.sql

# Then restart old image
docker compose up -d app
```

---

## New Required Environment Variables

Check each release's CHANGELOG for new required vars. Common pattern for new features:

| Feature | Env var | Default | Required? |
|---|---|---|---|
| Build cache | `BUILD_CACHE_DIR` | `.build-cache/` | No |
| Geo routing | `ENABLE_GEO_ROUTING` | `false` | No |
| Node region | `NODE_REGION` | `us-east-1` | No (but set it) |
| Rust proxy listen | `PROXY_LISTEN_ADDR` | `0.0.0.0:8090` | Only if using proxy |
| Metrics | `METRICS_TOKEN` | empty (open) | No |

---

## Rust Proxy Upgrade

The Rust proxy (`crates/nexus-proxy`) is a separate binary. It is rebuilt by Docker:

```bash
# Rebuild the proxy image
docker compose build proxy

# Restart the proxy
docker compose up -d --force-recreate proxy
```

If the proxy crashes on startup:
1. Check logs: `docker compose logs proxy`
2. Most common cause: `DATABASE_URL`, `OBJECT_STORAGE_*`, or `COOKIE_SECRET` mismatch with the app
3. Verify it can reach the database: `docker compose run --rm proxy` and look for "DB pool ready"

---

## After Any Upgrade

- [ ] `GET /api/health/live` returns `{"status":"ok"}`
- [ ] `GET /api/health/ready` returns `{"status":"ok"}` (DB + Redis connected)
- [ ] Dashboard loads and shows correct site list
- [ ] A test deploy completes successfully
- [ ] Federation peers are still listed in Admin → Federation
- [ ] Prometheus metrics endpoint responds: `GET /metrics`
