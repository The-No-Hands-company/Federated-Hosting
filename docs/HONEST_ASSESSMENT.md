# Honest Engineering Assessment

**Last updated:** March 2026
**Assessment type:** Pre-production audit
**Conclusion:** Significantly more complete than the initial audit. Core platform gaps have been closed. Remaining gaps are real but non-blocking for a limited production launch.

---

## What Has Been Fixed Since Initial Assessment

Every item from the original critical/high list has been addressed:

| Issue | Original Severity | Resolution |
|---|---|---|
| Object storage Replit-only | CRITICAL | `storageProvider.ts` with `S3StorageProvider` (AWS SDK v3) + env-var provider selection |
| No database migrations | CRITICAL | `0000_initial_schema.sql` (25 tables) + `migrate.ts` runner |
| Rate limiting in-memory | CRITICAL | Redis-backed with 7 limiters; warns in prod if Redis missing |
| Unlock cookie not verified | HIGH | HMAC-signed with `crypto.timingSafeEqual`, 24-hour expiry |
| Admin has no RBAC | HIGH | `requireAdmin.ts` middleware, `isAdmin` DB column + `ADMIN_USER_IDS` env var |
| Host router 2-3 DB queries/request | HIGH | LRU cache: 10K domains, 50K files, 5-min TTL, invalidated on deploy |
| DB pool no config | MEDIUM | Explicit max/min/idleTimeoutMillis/connectionTimeoutMillis |
| Session expiry not cleaned up | MEDIUM | Background job every 6 hours |
| Analytics bulk delete unsafe SQL | MEDIUM | `inArray()` replaces manual SQL |
| Health monitor single-failure flip | MEDIUM | N=3 consecutive failures required |
| Federation replay attack window | MEDIUM | 5-minute timestamp enforcement on all signed messages |
| i18n bundled synchronously | LOW | `i18next-http-backend`, async HTTP loading |
| Federation sync no retry | MEDIUM | `syncRetryQueue.ts`: 30s→2m→10m→1h→6h, max 10 attempts |
| No email verification | HIGH | SHA-256 tokens, 24h TTL, sent on OIDC login, resend API |
| No per-user caps | MEDIUM | Operator-set storage cap per user (0 = unlimited) |
| No IP banning | MEDIUM | `ip_bans` table, `apiBanMiddleware`, admin CRUD UI |
| No abuse handling | HIGH | `abuse_reports` table, public report endpoint, admin review/takedown flow |
| No federation trust levels | MEDIUM | `node_trust` table: unverified→verified→trusted, failed pings tracked |
| Build cache missing | MEDIUM | Lockfile SHA-256 cache, `BUILD_CACHE_DIR` configurable |
| Preview deployments missing | MEDIUM | Non-main branches → `{branch}--{domain}` preview URL |
| No admin moderation UI | MEDIUM | Abuse review tab + IP ban management in Admin page |
| HONEST_ASSESSMENT.md stale | MEDIUM | This document |

---

## What Is Actually Working (March 2026)

| Component | Status |
|---|---|
| PostgreSQL schema + Drizzle ORM | ✅ Solid — correct schema, good indexes |
| Ed25519 federation protocol | ✅ Correct — sign/verify, replay window enforced |
| Node trust scoring | ✅ Upserted on every ping; auto-promotes at 50 successful pings |
| Zod input validation | ✅ All routes covered |
| Auth (session + Bearer token) | ✅ Works correctly |
| Email verification | ✅ SHA-256 tokens, 24h TTL, non-blocking on login |
| Per-user storage quotas | ✅ Enforced on every deployment |
| IP ban middleware | ✅ 60s in-memory cache, admin CRUD |
| Abuse report flow | ✅ Submit → admin review → takedown → audit log |
| Build cache | ✅ Lockfile hash, symlinked node_modules on hit |
| Preview deployments | ✅ Branch-based, `{branch}--{domain}` URL |
| Deployment atomicity | ✅ DB transaction wraps all deploy steps |
| Rate limiting | ✅ Redis-backed, 7 limiters, fail-open with log |
| File path sanitization | ✅ Directory traversal prevented |
| Structured logging + redaction | ✅ Private keys/passwords never logged |
| Rust proxy | ✅ All 9 TODOs complete; Brotli, LRU, Redis invalidation, Prometheus |
| Admin RBAC | ✅ `requireAdmin` enforced on all admin routes |
| Admin audit log | ✅ All admin actions recorded |
| Admin moderation UI | ✅ Abuse reports + IP bans in Admin page |
| Analytics rollup | ✅ Fixed — `inArray()`, 6h cleanup job |
| Geographic routing algorithm | ✅ Region/prefix matching, 40+ country codes |
| ACME TLS automation | ✅ HTTP-01 + DNS-01, 12h renewal scheduler |
| Build pipeline | ✅ Git clone → cache-aware install → build → deploy |
| Content deduplication | ✅ SHA-256 hash, objectPath reuse across sites |
| Docker Compose | ✅ Redis + MinIO + Caddy + Rust proxy wired |

---

## Remaining Honest Gaps

### 1. Revenue / Donations

**Not a gap — NexusHosting is intentionally free.**

NexusHosting is free for everyone, always. There are no tiers, no paid plans, no Stripe integration. If operators want to sustain their node, they can accept voluntary donations. This is a deliberate design decision, not a missing feature.

### 2. Malware Scanning on Upload

**Severity: HIGH (for public hosting)**

Files are uploaded to S3 without any content scanning. A user can deploy a phishing page, malware distribution site, or illegal content. The abuse report flow handles *reported* content, but there is no proactive scanning.

**What's needed:** ClamAV hook on the upload path (async scan, takedown on detection). This requires ClamAV running as a sidecar or external service.

### 3. Canonical External Seed Nodes

**Severity: HIGH (for federation to work at scale)**

The bootstrap endpoint (`GET /api/federation/bootstrap`) only returns nodes already in your local database. A brand-new node has nobody to federate with.

**What's needed:** A well-known URL (e.g. `https://bootstrap.nexushosting.example/nodes`) that any new node can query to get an initial peer list. This requires running at least one always-on public bootstrap node.

### 4. Dynamic Site Federation Undefined

**Severity: MEDIUM**

The federation sync protocol handles static files only. When an NLPL or Node.js site is replicated, the receiving node gets the files but has no way to know how to run the process, what environment variables to inject, or what port to listen on.

**What's needed:** A federation spec extension for dynamic sites — replicate the `site_type`, `buildCommand`, env var keys (not values), and NLPL entry point.

### 5. Upgrade Runbook Missing

**Severity: HIGH (for operators)**

There is no documented upgrade path from one version to the next. For a PostgreSQL-backed service with schema migrations, this is a real gap — an operator who doesn't know the migration story can easily corrupt their database.

**What's needed:** `docs/UPGRADE.md` covering: how to check current schema version, how to apply new migrations, whether the API server supports zero-downtime rolling deploys.

### 6. Incident Response Missing

**Severity: MEDIUM**

No documentation for common failure scenarios:
- Node disk full → what to do
- Site reported for abuse → step-by-step
- Federation breaks (all peers go offline) → recovery
- Database at 95% capacity → playbook

### 7. Email Verification Not Enforced on Actions

**Severity: MEDIUM**

Verification emails are sent, but unverified users can still deploy sites. This means:
- Fake email addresses can create sites
- Abuse is harder to attribute

**What's needed:** A middleware check on deploy/create that blocks unverified users after a grace period (e.g. 7 days), with clear error message.

### 8. CIDR-Range IP Bans

**Severity: LOW**

The `ip_bans` table has a `cidr_range` column but the middleware only checks `ipAddress` exact match. Subnet-level bans don't work.

---

## What Is NOT a Gap (Clearing Up Confusion)

Some things that looked like gaps are actually resolved:

- **"Bootstrap only returns your own nodes"** — Partially true but the real gap is the lack of an *external* public seed list. The endpoint itself works correctly for nodes you know about.
- **"No session cleanup"** — Fixed. 6-hour background job runs `DELETE FROM sessions WHERE expire < NOW()`.
- **"Rate limiting useless multi-instance"** — Fixed. Redis store shared across instances when `REDIS_URL` set.
- **"ACME is a stub"** — Fixed. Full `acme-client` implementation with HTTP-01 and DNS-01.
- **"No admin RBAC"** — Fixed. `requireAdmin` middleware, `isAdmin` column, `ADMIN_USER_IDS` env.

---

## Realistic Path to Production

For a **small private deployment** (< 100 users, trusted community):

The project is deployable today. Run `docker compose up`, configure OIDC + S3, and it works. The gaps (billing, malware scanning, seed nodes) don't matter at this scale.

For a **public deployment** (unknown users, open registration):

Before accepting public registrations:
1. Wire malware scanning (ClamAV or a cloud API) — or disable public uploads until ready
2. Document and test the abuse flow end-to-end
3. Decide on email verification grace period enforcement
4. Write the upgrade runbook before you have real data at risk

For **federation with unknown third-party nodes**:

The trust scoring system exists but there's no governance layer — any node that passes the handshake can federate. Until there's a canonical seed list and a trust-review process, treat federation as a private network feature.

---

*This document should be updated whenever a gap is closed. Do not let it go stale again.*
