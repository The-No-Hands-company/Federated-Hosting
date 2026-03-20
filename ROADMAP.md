# Federated Hosting — Roadmap

A living document tracking what has been built, what is in progress, and where the project is heading.

---

## Legend

- ✅ Done
- 🔄 In progress / partially done
- 📋 Planned (next up)
- 🔮 Future / stretch goal

---

## Phase 1 — Foundation ✅

| Feature | Status | Notes |
|---|---|---|
| Monorepo (pnpm workspaces) | ✅ | lib/db, artifacts/api-server, artifacts/federated-hosting |
| PostgreSQL + Drizzle ORM | ✅ | Nodes, sites, deployments, federation events, auth, analytics, access, domains |
| Replit Auth (OpenID Connect) | ✅ | Sign-in, session, user API |
| Express 5 API server + structured logging | ✅ | Pino, request IDs, trust-proxy |
| Ed25519 key pair generation | ✅ | Per-node public/private keys |
| Federation discovery, handshake, ping | ✅ | Ed25519-signed, event log |
| Node health monitor (background job) | ✅ | Pings all peers every 2 min |
| Object storage integration | ✅ | Presigned upload/download |
| Site file serving by domain | ✅ | Host-header routing + custom domain resolution |
| Capacity tracking | ✅ | Per-node + network-wide |
| Rate limiting + production hardening | ✅ | Helmet, compression, error handler, graceful shutdown |

---

## Phase 2 — User-Facing Product ✅

| Feature | Status | Notes |
|---|---|---|
| Dashboard with live network stats + area chart | ✅ | |
| Federation Nodes + Sites pages | ✅ | |
| Sites Directory (public, filterable) | ✅ | |
| My Sites (authenticated, inline register modal) | ✅ | Hit counts, last-updated |
| Deploy Site page | ✅ | Drag-and-drop, file preview panel, rollback |
| Federation Protocol page | ✅ | Live peers, event log, protocol reference |
| Onboarding flow (first-time user) | ✅ | 4-step guided modal, dismissible banner |

---

## Phase 3 — Bundled Sites ✅

Auto-seeded demo sites ship with every node on first boot.

---

## Phase 4 — Federation Replication ✅

| Feature | Status | Notes |
|---|---|---|
| Site sync push (notify peers on deploy) | ✅ | Signed site_sync events |
| Federation manifest endpoint | ✅ | GET /federation/manifest/:domain — signed file list + presigned URLs |
| Site sync pull (actual file replication) | ✅ | POST /federation/sync downloads files, stores locally, creates replica deployment |
| Gossip-based peer discovery | ✅ | 5-min background push + manual discover trigger |

---

## Phase 5 — Access Control + Custom Domains ✅

| Feature | Status | Notes |
|---|---|---|
| Site visibility (public / private / password) | ✅ | scrypt password hash, unlock cookie |
| Team members (owner / editor / viewer) | ✅ | |
| API tokens | ✅ | SHA-256 hashed, named, optional expiry |
| CLI Bearer token auth | ✅ | Authorization: Bearer fh_<token> |
| Custom domain CNAME + TXT verification | ✅ | DNS lookup at _fh-verify.<domain> |

---

## Phase 6 — Analytics, Admin, CLI, Docker ✅

| Feature | Status | Notes |
|---|---|---|
| Per-site analytics (hits, bandwidth, referrers, top paths) | ✅ | Hourly rollup via background flush job |
| Analytics dashboard page | ✅ | Period selector, area chart, top paths + referrers |
| Node operator admin dashboard | ✅ | System info, editable settings, federation events |
| fh CLI tool | ✅ | login, deploy, sites, tokens commands |
| Deployment rollback | ✅ | One-click, history preserved |
| Site file preview before deploy | ✅ | Collapsible file tree with icons + live/pending status |
| Docker Compose (self-hosted stack) | ✅ | PostgreSQL 16 + MinIO + migrate + app |
| Self-hosting guide | ✅ | docs/SELF_HOSTING.md |
| GitHub Actions deploy workflow | ✅ | .github/workflows/deploy.yml |
| Drizzle migrations (replace db push) | ✅ | generate + migrate scripts |
| CLAUDE.md development charter | ✅ | Scale, architecture, principles, what not to do |

---

## Phase 7 — Production Launch 📋

| Feature | Status | Notes |
|---|---|---|
| Bahasa Indonesia i18n | ✅ | Full en + id translations, browser detection, localStorage persistence |
| End-to-end test suite (Playwright) | ✅ | health.spec.ts + deploy.spec.ts (11-step critical path) |
| OpenAPI spec sync with actual routes | ✅ | Redocly lint in CI, spec v0.7.0 fully covers all routes |
| Webhook notifications | ✅ | node_offline, node_online, deploy, deploy_failed, new_peer — Ed25519 signed |
| Rollback via CLI | ✅ | fh rollback --site <id> [--version <n>] with interactive picker |
| fh analytics + fh status CLI commands | ✅ | ASCII bar charts for traffic, node health summary |
| @fedhost/cli published to npm | 🔄 | publish-cli.yml workflow ready, needs NPM_TOKEN secret |
| Public bootstrap node registry | ✅ | GET /api/federation/bootstrap — healthy verified peers, 24h window |
| Mobile-responsive layout audit | ✅ | Verified responsive grids across all pages |

---

## Phase 8 — Growth 🔮

| Feature | Status | Notes |
|---|---|---|
| Node marketplace / directory | ✅ | /network page — searchable node grid, bootstrap endpoint, status |
| Let's Encrypt TLS automation | ✅ | HTTP-01 challenge serving, /provision-tls, Caddy/certbot instructions |
| Geographic routing | ✅ | Region inference from headers, closest-node 302 redirect, ENABLE_GEO_ROUTING flag |
| Paid plans / node sponsorship | 🔮 | Revenue model for operators |
| Public API docs site | ✅ | /api-docs page — endpoint browser, auth guide, code examples |

---

## Tech Debt

| Item | Priority |
|---|---|
| E2E test suite (Playwright) | ✅ | health, deploy (11-step), security (20+ auth tests) |
| OpenAPI spec kept in sync | Medium |
| @fedhost/cli npm publish | Medium |
| Rate limiting on all write endpoints | ✅ | writeLimiter, tokenLimiter, webhookLimiter applied globally |
| Same-domain conflict resolution across nodes | ✅ | Ed25519 trust chain, first-write-wins, pubkey tiebreaker |

---

*Last updated: March 2026*
