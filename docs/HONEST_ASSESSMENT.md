# Honest Engineering Assessment

**Last updated:** March 2026  
**Assessment type:** Pre-production audit  
**Conclusion:** Not production-ready for 1.5B+ users. Significant foundational work remains.

This document replaces optimistic roadmap language with an honest account of what is built, what is broken, what is scaffolded-but-non-functional, and what is genuinely missing for scale.

---

## Critical Issues (Blockers for Any Production Deployment)

### 1. Object Storage is Replit-only — No Real S3 Support

**Severity: CRITICAL**

`artifacts/api-server/src/lib/objectStorage.ts` hardcodes 4 references to `REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106"`. This is a Replit-internal sidecar process. The entire file upload, download, and presigned URL system is non-functional outside Replit.

The self-hosting guide claims S3 support — it does not exist. Docker Compose ships MinIO but the application cannot talk to it.

**What needs to be done:** Full rewrite of `objectStorage.ts` using the AWS SDK v3 (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`) with environment-based endpoint configuration. Replit support can remain as one provider implementation.

---

### 2. No Database Migrations — `db push` is Destructive in Production

**Severity: CRITICAL**

`lib/db/migrations/` does not exist. The project uses `drizzle-kit push` which directly mutates the live database schema without a migration history. For a service handling user data at scale, this means:
- No rollback if a schema change breaks production
- No audit trail of schema evolution
- Potential data loss on column drops

**What needs to be done:** Run `pnpm --filter @workspace/db run generate` to generate the initial migration SQL. Commit it. Update all deployment documentation and Docker Compose to run `migrate` not `push`.

---

### 3. Rate Limiting is In-Memory — Broken in Multi-Instance Deployments

**Severity: CRITICAL**

`express-rate-limit` with no configured `store` uses an in-memory counter. Every instance of the API server has its own counter. Running 3 instances effectively multiplies all rate limits by 3, making them useless. At any meaningful scale, you run multiple instances.

**What needs to be done:** Configure a shared `RedisStore` for `express-rate-limit`. Add Redis to Docker Compose and `REDIS_URL` to `.env.example`.

---

### 4. Session Storage Has No Expiry Cleanup Job

**Severity: HIGH**

Sessions are stored in the `sessions` PostgreSQL table. Expired sessions are checked at read time but never purged. Over months, this table grows unboundedly. On a service with millions of users, this becomes a significant query performance problem and storage cost.

**What needs to be done:** A periodic background job (or PostgreSQL `pg_cron` task) to `DELETE FROM sessions WHERE expire < NOW()`.

---

### 5. Password-Protected Sites: Unlock Cookie is Not Cryptographically Verified

**Severity: HIGH — Security Vulnerability**

In `routes/access.ts`, the unlock endpoint issues a cookie with value `crypto.randomBytes(16).toString("hex")`. In `middleware/hostRouter.ts`, the check is simply:

```typescript
if (site.visibility === "password" && !req.cookies?.[`site_unlock_${site.id}`])
```

**The cookie value is never verified against anything.** A user can set `site_unlock_5=aaaa` in their browser DevTools and bypass password protection on site 5. The server treats the presence of the cookie as proof of authentication.

**What needs to be done:** Either (a) store valid unlock tokens in the database/Redis and verify the cookie value against the stored token, or (b) use HMAC-signed cookies (e.g. `cookie-signature`).

---

### 6. Admin Endpoints Have No Role-Based Access Control

**Severity: HIGH — Security Vulnerability**

All `/api/admin/*` endpoints check only `req.isAuthenticated()`. Any logged-in user can access the operator dashboard, view all users, view all sites, and modify node settings. There is no concept of an "operator" or "admin" role.

**What needs to be done:** Add an `isAdmin` flag to the `users` table (or read from an `ADMIN_USER_IDS` env var), and enforce it on all admin routes.

---

### 7. Host Router Makes 2–3 Database Queries Per Request — No Caching

**Severity: HIGH — Performance**

Every HTTP request to a hosted site triggers:
1. `SELECT` from `sitesTable` by domain
2. (if custom domain) `SELECT` from `customDomainsTable`, then `SELECT` from `sitesTable`
3. `SELECT` from `siteFilesTable` by siteId + filePath
4. `INSERT` into `analyticsBufferTable`

At 1.5B users, even 100 requests/second means 300–400 database operations per second just for this middleware. Without a caching layer, the database is the bottleneck.

**What needs to be done:** An in-memory LRU cache (or Redis) for domain → site ID and filePath → objectPath lookups. Cache TTL of 60–300 seconds with cache invalidation on deploy.

---

### 8. ACME/TLS Automation is a Stub — Not Functional

**Severity: MEDIUM — Misleading**

`routes/tls.ts` has extensive comments about ACME but the actual implementation with `ACME_ENABLED=true` only registers a token in a Map and returns it. It does not:
- Create an ACME account
- Submit a certificate order to Let's Encrypt
- Wait for challenge verification
- Generate a CSR
- Retrieve and store the signed certificate

The `PRODUCTION_CHECKLIST.md` says TLS automation is available. It is not.

**What needs to be done:** Either implement the ACME flow using the `acme-client` npm package, or clearly mark TLS automation as "planned — use Caddy or certbot for now" and remove the misleading `ACME_ENABLED` env var from documentation.

---

### 9. DB Connection Pool Has No Limits

**Severity: MEDIUM — Performance**

```typescript
export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
```

`pg.Pool` defaults to `max: 10` connections. Under load this causes request queuing. More importantly, there is no `idleTimeoutMillis`, `connectionTimeoutMillis`, or `max` tuning. A misconfigured database can cause all pool connections to hang, freezing the entire API server.

**What needs to be done:** Explicit pool config:
```typescript
new Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.DB_POOL_MAX ?? "20"),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
})
```

---

### 10. Analytics Flush: Bulk Delete Uses Unsafe SQL Construction

**Severity: MEDIUM — Correctness**

```typescript
.where(sql`${analyticsBufferTable.id} = ANY(ARRAY[${sql.join(idsToDelete.map(id => sql`${id}`), sql`, `)}]::int[])`)
```

This constructs a raw SQL `ARRAY[1,2,3,...]` with up to 5000 elements. PostgreSQL has a hard limit on query complexity and this pattern can generate query strings exceeding the limit. It also leaks implementation details in error messages.

**What needs to be done:** Use Drizzle's `inArray()` operator: `.where(inArray(analyticsBufferTable.id, idsToDelete))`.

---

### 11. Federation: Replay Attack Window

**Severity: MEDIUM — Security**

The ping endpoint uses a timestamp to construct the signed message but does not check that the timestamp is recent. A valid signed message can be replayed indefinitely. The challenge string is random but there is no server-side record of which challenges have been used.

**What needs to be done:** Reject messages with a timestamp older than 5 minutes. Store used challenge strings in Redis with a 10-minute TTL to prevent replay.

---

### 12. Health Monitor Marks Node Offline After One Failed Check

**Severity: MEDIUM — Reliability**

A single network hiccup (transient DNS failure, brief connectivity issue) immediately flips a node to `inactive` and fires a `node_offline` webhook. For a global federation, transient failures are normal. Marking them as offline degrades the network's apparent health.

**What needs to be done:** Track consecutive failure count. Only mark offline after N consecutive failures (recommend N=3). Implement exponential backoff for known-offline nodes.

---

### 13. i18n Translations Loaded Synchronously at Bundle Time

**Severity: LOW — Performance**

Both `en.json` and `id.json` are bundled directly into the JavaScript bundle, increasing initial load size for all users regardless of their language. At scale with dozens of languages, this becomes significant.

**What needs to be done:** Use `i18next-http-backend` to lazy-load translation files from `/public/locales/en/translation.json` on demand.

---

## What Is Actually Working

| Component | Real Status |
|---|---|
| PostgreSQL schema + Drizzle ORM | ✅ Solid — correct schema, good indexes |
| Ed25519 federation protocol | ✅ Correct — sign/verify works, replay window enforced |
| Zod input validation on all routes | ✅ Complete coverage |
| Auth middleware (session + Bearer token) | ✅ Works correctly |
| Deployment atomicity (DB transactions) | ✅ Correct — never partial |
| Rate limiting logic | ✅ Correct — broken only in multi-instance |
| File path sanitization | ✅ Directory traversal prevented |
| Pino structured logging + redaction | ✅ Private keys/passwords redacted |
| Graceful shutdown | ✅ SIGTERM/SIGINT handled |
| Error handler (no stack traces in prod) | ✅ AppError + globalErrorHandler correct |
| Gossip peer discovery | ✅ Works for single-instance |
| Analytics rollup logic | ✅ Fixed — bulk delete now uses inArray() |
| Geographic routing algorithm | ✅ Correct — region/prefix matching works |
| Conflict resolution algorithm | ✅ Correct — first-write-wins is sound |
| CLI (deploy, rollback, analytics, status) | ✅ Works when pointing at a running node |
| Docker Compose | ✅ Works — except app→MinIO connection (object storage abstraction broken) |
| Playwright E2E tests | ✅ Solid test structure |
| OpenAPI spec | ✅ Comprehensive |

---

## What Is Scaffolded But Not Production-Ready

| Component | Reality |
|---|---|
| Object storage (S3/MinIO support) | Replit-only. Entire layer needs rewrite. |
| ACME/TLS automation | Stub. Issues challenge token but never gets certificate. |
| Database migrations | Zero migration files exist. |
| Redis session/rate-limit sharing | Not implemented. |
| Admin RBAC | ✅ Fixed — requireAdmin middleware, ADMIN_USER_IDS env var, isAdmin DB column |
| Password site cookies | ✅ Fixed — HMAC-signed, timingSafeEqual verified |
| Host router caching | ✅ Fixed — in-memory LRU cache, invalidated on deploy |
| DB pool configuration | ✅ Fixed — explicit max/min/idle/connect timeout config |
| Replay attack prevention | ✅ Fixed — 5-minute timestamp window enforced on ping |
| Federation sync retry queue | Returns "queued" but nothing actually retries. |

---

## What Needs to Happen Before Any Real Traffic

### Fixed Since Initial Assessment (March 2026)
- ✅ Analytics bulk delete SQL injection risk → `inArray()`
- ✅ DB pool explicit configuration (max, min, timeouts, error handler)  
- ✅ Unlock cookie security theater → HMAC-signed, timingSafeEqual verified
- ✅ Admin RBAC → `requireAdmin` middleware, `isAdmin` DB column, `ADMIN_USER_IDS` env
- ✅ Host router LRU cache → 2-3 DB queries per request → 0 for warm entries
- ✅ Session expiry cleanup job (6-hour interval)
- ✅ Health monitor N=3 failure threshold (was: mark offline on first hiccup)
- ✅ Federation ping replay attack window (5-minute timestamp check)
- ✅ S3 storage abstraction layer scaffolded (`storageProvider.ts` with S3Provider + ReplitProvider)

### Priority 1 — Cannot Launch Without These
1. Wire `storageProvider.ts` into all routes replacing `objectStorage.ts` (abstraction built, integration work remains)
2. Generate and commit Drizzle migrations
3. Add Redis and configure shared rate-limit + session stores
4. ✅ Fix unlock cookie verification (HMAC-signed, timingSafeEqual)
5. ✅ Add admin RBAC (requireAdmin middleware, isAdmin column, ADMIN_USER_IDS env)
6. ✅ Host router LRU cache for domain and file lookups, invalidated on deploy

### Priority 2 — Needed Within First Month
7. ✅ DB pool configuration (max, min, idle timeout, connect timeout)
8. ✅ Session expiry cleanup (background job, runs every 6 hours)
9. ✅ Analytics flush bulk delete fixed (inArray)
10. ✅ Health monitor N=3 consecutive failure threshold
11. ✅ Replay attack window enforced (5-minute timestamp check)
12. Mark ACME as non-functional or actually implement it
13. Admin audit logging (who changed what, when)

### Priority 3 — Before Scaling Past ~10K Users
14. Redis-backed caching for host router
15. Content deduplication for site files (store hash, deduplicate objectPath)
16. Lazy-load i18n translations
17. Virtual scrolling for large lists (nodes, sites, events)
18. Federation sync retry queue (proper job queue, not fire-and-forget)
19. Prometheus metrics endpoint
20. CDN integration for static assets

---

## Realistic Timeline

A realistic path to production-readiness for a team of 3–5 engineers:

| Milestone | Work | Time |
|---|---|---|
| Storage abstraction (S3/MinIO) | Priority 1 item #1 | 2–3 weeks |
| Auth/security fixes (#4, #5, #6) | Priority 1 items #4–5 | 1 week |
| Infrastructure (Redis, migrations, pool) | Priority 1 items #2, #3, #6 | 1–2 weeks |
| Priority 2 fixes | Items #7–13 | 2–3 weeks |
| Load testing + fixing what breaks | — | 2–3 weeks |
| Priority 3 (scaling layer) | Items #14–20 | 4–6 weeks |
| **Total** | | **~3–4 months** |

This assumes a small but dedicated engineering team. The protocol design and API structure are sound. The work remaining is mostly infrastructure and security hardening, not redesign.

---

*This document should be updated as issues are resolved.*

---

## Issues Resolved Since Initial Assessment

The following critical and high-severity issues from this document have been fixed:

| Issue | Resolution |
|---|---|
| Object storage Replit-only | `storageProvider.ts` with `S3StorageProvider` (AWS SDK v3) + `ReplitStorageProvider` |
| No database migrations | `lib/db/migrations/0000_initial_schema.sql` + `migrate.ts` runner |
| Rate limiting in-memory only | `redis.ts` singleton + Redis store in all 7 rate limiters; warns in prod if missing |
| Unlock cookie not verified | HMAC-signed with `crypto.createHmac` + `timingSafeEqual` verification in host router |
| Admin has no RBAC | `requireAdmin.ts` middleware, `isAdmin` column on `users` table |
| Host router DB queries per request | `domainCache.ts` LRU (10K domains, 50K files, 5-min TTL, invalidated on deploy) |
| DB pool no config | Explicit `max`, `min`, `idleTimeoutMillis`, `connectionTimeoutMillis`, pool error handler |
| Session expiry not cleaned up | Background job every 6 hours deletes expired sessions |
| Analytics `sql.join` unsafe | Replaced with `inArray()` |
| Health monitor single-failure flip | N=3 consecutive failure threshold, per-domain failure counter |
| Federation replay attack window | 5-minute timestamp check on ping endpoint |
| i18n bundled synchronously | `i18next-http-backend` loads translations via HTTP from `/locales/` |
| Federation sync no retry | `syncRetryQueue.ts` with exponential backoff (30s→2m→10m→1h→6h), max 10 attempts |
| Docker Compose broken MinIO | S3StorageProvider wired; Redis added to Compose; `REDIS_URL` env var |

**Remaining genuine gaps:**
- ACME/TLS automation is still a stub (use Caddy)
- Admin action audit log not built
- File content deduplication not built
- Prometheus metrics not built
- Session store is PostgreSQL (works, not Redis-shared across instances)
- Gossip in-memory per-instance (eventual consistency over TTL)

*Last updated: March 2026*
