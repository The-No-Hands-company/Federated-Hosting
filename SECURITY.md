# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| `main` branch | Yes |
| All other branches | No |

We only provide security fixes for the current `main` branch. If you are running a forked or older version, please update before reporting.

---

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

To report a vulnerability, email:

**security@the-no-hands-company.com**

Include:

- A clear description of the vulnerability
- Steps to reproduce (proof of concept if possible)
- The potential impact
- Any suggested mitigation or fix

We will acknowledge receipt within **48 hours** and provide a resolution timeline within **7 days** for critical issues.

---

## Security Model

### Cryptographic identity

Every federation node generates an **Ed25519 key pair** on first boot using Node.js's built-in `crypto` module. The public key is published at `/.well-known/federation`. The private key is stored only in the local database and is **never transmitted** over the network.

All inter-node pings and sync notifications are signed with the originating node's private key. The receiving node verifies the signature against the sender's published public key before accepting the event as verified.

### Authentication

Users authenticate via **OIDC Auth** (OpenID Connect with PKCE). Session tokens are stored in the database (not in JWTs), are HttpOnly + Secure cookies, and expire after a configurable TTL.

### Rate limiting

| Endpoint group | Limit |
|----------------|-------|
| All endpoints | 200 req / min / IP |
| `/api/login`, `/api/callback` | 20 req / min / IP |
| `/api/sites/:id/files/upload-url` | 20 req / min / IP |
| `/api/federation/ping`, `/api/federation/handshake` | 50 req / min / IP |

Exceeding any rate limit returns `429 Too Many Requests`.

### File upload safety

- Files are uploaded directly to object storage via presigned URLs — file bytes never pass through the API server
- Per-file size limit: **50 MB**
- Per-deployment size limit: **500 MB**
- Allowed content types are whitelisted; anything else is rejected with `400`
- All file paths are sanitised with `path.normalize` and leading `..` components are stripped (prevents directory traversal)

### HTTP security headers (via helmet)

| Header | Value |
|--------|-------|
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains` |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Content-Security-Policy` | restrictive default policy |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | camera, microphone, geolocation disabled |

### Logging and data privacy

Structured logs (pino) automatically **redact** the following fields:

- `privateKey`
- `password`

Stack traces are **never included** in API error responses when `NODE_ENV=production`.

### Database atomicity

All multi-step deploy operations run inside a **database transaction**. If any step fails, the entire operation is rolled back — there are no partial deploys.

---

## Known Limitations

- **Full file replication** is not yet implemented. Currently, only metadata is synced to peers on deploy; file bytes remain on the originating node's object storage. This means if the originating node is unavailable, peers cannot serve the files.
- **Federation peer verification** relies on the peer's public key being registered in the local database. An attacker who can insert a node record with a forged key could pass ping verification. Node registration should be restricted to trusted administrators in production.
- **Session storage** is in the PostgreSQL database. High-volume deployments should consider adding a TTL-based cleanup job for expired sessions.

---

## Dependency Security

We use `pnpm` as the package manager. Lock file integrity is enforced via `pnpm-lock.yaml`. We recommend running `pnpm audit` regularly to check for known vulnerabilities in dependencies.

---

## Disclosure Policy

We follow **coordinated disclosure**:

1. Reporter submits vulnerability privately
2. We confirm and reproduce within 48 hours
3. We develop and test a fix
4. We release the fix and credit the reporter (unless they prefer anonymity)
5. We publish a brief public advisory after the fix is deployed

---

## Contact

- **Security email**: security@the-no-hands-company.com
- **GitHub**: https://github.com/The-No-Hands-company/Federated-Hosting
