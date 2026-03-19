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

Core infrastructure, auth, and a working federation protocol.

| Feature | Status | Notes |
|---|---|---|
| Monorepo structure (pnpm workspaces) | ✅ | `lib/db`, `artifacts/api-server`, `artifacts/federated-hosting` |
| PostgreSQL database with Drizzle ORM | ✅ | Nodes, sites, deployments, federation events, auth schemas |
| Replit Auth (OpenID Connect) | ✅ | Sign-in, session, user API |
| Express API server with structured logging | ✅ | Pino logger, request IDs, trust-proxy fix |
| Ed25519 key pair generation | ✅ | Per-node public/private keys, SPKI format |
| `/.well-known/federation` discovery endpoint | ✅ | Public node metadata + public key |
| Federation handshake (node-to-node) | ✅ | Signed ping, peer registration, event logging |
| Federation ping endpoint | ✅ | Verifies Ed25519 signature from remote node |
| Federation event log | ✅ | Handshake, ping, site_sync, node_offline, key_rotation |
| Node health monitor (background job) | ✅ | Pings all peers every 2 min, flips status, logs node_offline events |
| FEDERATION.md protocol spec | ✅ | Language-agnostic spec for third-party node implementors |
| Object Storage integration | ✅ | File upload/download for site assets |
| Site file serving by domain | ✅ | `GET /api/sites/serve/:domain/*` |
| Capacity tracking (storage + bandwidth) | ✅ | Per-node and network-wide summary |
| Rate limiting on federation endpoints | ✅ | `express-rate-limit` on handshake/ping |

---

## Phase 2 — User-Facing Product ✅ / 🔄

The dashboard, site management flow, and UI panels users interact with daily.

| Feature | Status | Notes |
|---|---|---|
| Dashboard with live network stats | ✅ | Active nodes, hosted sites, uptime, bandwidth, 24h activity chart |
| Node Consensus sidebar | ✅ | Per-node status with health indicator |
| Federation Nodes list + detail page | ✅ | View all nodes, capacity, generate keys |
| Hosted Sites list + detail page | ✅ | Network-wide site browser |
| Sites Directory (public) | ✅ | Filterable public directory of active sites |
| My Sites (authenticated) | ✅ | Register sites inline, hit counts, last-updated, animated cards |
| Site registration form (inline modal) | ✅ | No navigation away from My Sites |
| Deploy Site page | ✅ | File upload and deploy trigger |
| Federation Protocol page | ✅ | Auto-load identity, live peers grid, auto-refresh event log, collapsible protocol ref |
| End-to-end deploy flow (sign in → upload → deploy → view) | 🔄 | API works; needs UI polish and end-to-end smoke test |
| Deployed site actually serves over HTTP | 🔄 | Route exists but needs verification at real domain/path |

---

## Phase 3 — Bundled Sites 📋

Two real sites that ship with every node and demonstrate the platform.

| Feature | Status | Notes |
|---|---|---|
| `fedhosting-landing` — project landing page | ✅ | Live at `/api/sites/serve/fedhosting.network/` — pulls live node stats |
| `nohands-company` — No Hands Company portfolio | ✅ | Live at `/api/sites/serve/nohands.company/` |
| Auto-seeder on startup (`seedBundledSites`) | ✅ | Idempotent — plants both sites into DB + object storage on first boot |

---

## Phase 4 — Federation Replication 📋

Making the network actually federated — sites sync across nodes.

| Feature | Status | Notes |
|---|---|---|
| Site sync push (notify peers of new deployment) | 🔄 | `POST /api/federation/notify-sync` exists; peers don't pull yet |
| Site sync pull (fetch files from originating node) | 📋 | Node receives notify-sync, downloads files, creates local deployment |
| Conflict resolution (same domain on two nodes) | 📋 | Trust-chain based on `joinedAt` and signature |
| Replication status UI | 📋 | Show which peers have a copy of each site |
| Automatic re-sync on node reconnect | 📋 | When health monitor sees a node come back online, trigger re-sync |

---

## Phase 5 — Polish & Production 📋

Making the product ready for real users and real traffic.

| Feature | Status | Notes |
|---|---|---|
| Mobile-responsive layout | 📋 | Dashboard and My Sites need responsive breakpoints |
| Onboarding flow (first-time user guide) | 📋 | Walk new users through: sign in → register site → upload → deploy |
| Custom domain support | 📋 | CNAME records pointing to node, TLS via Let's Encrypt |
| Site preview before deploy | 📋 | Show a static preview of uploaded files |
| Deployment rollback / version history | 📋 | Keep last N deployments per site, one-click rollback |
| Per-site analytics (hit counts, unique visitors, geographic) | 📋 | Extend existing `hit_count` tracking |
| Email / webhook notifications for node events | 📋 | Node offline, new peer, deployment failed |
| Production deployment configuration | 📋 | Deploy to Replit autoscale, environment secrets, health check URL |
| Node operator settings page | 📋 | Edit node name, region, storage limits, operator contact |

---

## Phase 6 — Growth & Internationalisation 🔮

Expanding reach, especially toward the Indonesian market.

| Feature | Status | Notes |
|---|---|---|
| Bahasa Indonesia i18n | 🔮 | UI translations for the Indonesian audience |
| Node discovery registry | 🔮 | A well-known public list of active federation nodes to bootstrap from |
| Public API docs site | 🔮 | Developer-facing docs generated from OpenAPI spec |
| Node marketplace / directory | 🔮 | Browse and join existing federation networks |
| Paid plans / node sponsorship | 🔮 | Revenue model for node operators |
| CLI tool (`fedhost deploy`) | 🔮 | Deploy a site from the terminal without the UI |
| GitHub Actions integration | 🔮 | Auto-deploy on `git push` via CI |

---

## Tech Debt & Maintenance

| Item | Priority |
|---|---|
| End-to-end test suite (Playwright) | High |
| OpenAPI spec kept in sync with actual routes | Medium |
| Rate limiting on all write endpoints (not just federation) | Medium |
| Drizzle migrations instead of `db push` | Medium |
| Node.js graceful shutdown improvements | Low |

---

*Last updated: March 2026*
