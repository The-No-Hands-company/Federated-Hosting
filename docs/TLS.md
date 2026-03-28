# TLS / Certificate Setup

Nexus Hosting supports three paths to HTTPS for custom domains:

---

## Option 1 — Caddy (recommended for most operators)

The simplest path. Caddy handles certificate issuance and renewal automatically with no configuration beyond pointing it at the app.

```
# /etc/caddy/Caddyfile
node.yourdomain.com {
    reverse_proxy localhost:8080
}
```

Caddy handles all ACME negotiation transparently. No `ACME_*` env vars needed.

---

## Option 2 — Built-in ACME: HTTP-01 (port 80 required)

The built-in ACME module uses Let's Encrypt directly.

**Requirements:**
- Port 80 publicly reachable from Let's Encrypt servers
- `ACME_EMAIL` set to a valid address for Let's Encrypt notifications

```env
ACME_ENABLED=true
ACME_EMAIL=ops@yourdomain.com
ACME_CERT_DIR=/etc/certs
ACME_STAGING=false          # set true for testing
ACME_CHALLENGE_TYPE=http    # default
```

How it works:
1. When a custom domain is verified and `POST /api/domains/:id/provision-tls` is called, the server orders a certificate from Let's Encrypt.
2. Let's Encrypt requests a file at `http://<domain>/.well-known/acme-challenge/<token>`.
3. The app serves the token from its built-in challenge route.
4. Let's Encrypt verifies it and issues the certificate.
5. Cert is written to `ACME_CERT_DIR/<domain>/fullchain.pem` and `privkey.pem`.
6. Renewal runs automatically every 12 hours, renewing certs with <30 days remaining.

**Important:** Your reverse proxy (nginx/Caddy) must forward port 80 requests to the app, not redirect them, during the challenge window.

---

## Option 3 — Built-in ACME: DNS-01 (no port 80 required)

DNS-01 proves domain ownership by creating a TXT record instead of serving a file. This works behind NAT, firewalls, and private networks. It also supports wildcard certificates.

```env
ACME_ENABLED=true
ACME_EMAIL=ops@yourdomain.com
ACME_CERT_DIR=/etc/certs
ACME_CHALLENGE_TYPE=dns
ACME_DNS_PROPAGATION_WAIT=30000   # ms to wait after creating TXT record (default: 30s)
```

**DNS-01 requires registering a hook** so the app can create and clean up the TXT record via your DNS provider's API. Add this to your startup configuration:

```typescript
// In a custom startup file or via environment hooks
import { registerDnsHooks } from "./lib/acme";

registerDnsHooks(
  async (domain, txtValue) => {
    // Create _acme-challenge.<domain> TXT record with value txtValue
    // Example using Cloudflare:
    await cloudflare.dns.records.create(zoneId, {
      type: "TXT",
      name: `_acme-challenge.${domain}`,
      content: txtValue,
      ttl: 60,
    });
  },
  async (domain, txtValue) => {
    // Clean up the TXT record after verification
    // Find and delete the record with matching content
  }
);
```

### Per-provider setup

**Cloudflare:**
1. Create an API token with `Zone:DNS:Edit` permission
2. Use `cloudflare` npm package or the REST API
3. Set propagation wait to `10000` (10s) — Cloudflare propagates fast

**AWS Route 53:**
1. Create an IAM policy with `route53:ChangeResourceRecordSets` permission
2. Use `@aws-sdk/client-route-53`
3. Set propagation wait to `30000` (30s minimum)

**DigitalOcean:**
1. Generate a personal access token with write scope
2. Use `@digitalocean/sdk` or the REST API
3. Set propagation wait to `30000`

**Other providers:**
Any provider with a DNS API can be used. The hook receives the domain and TXT value — the implementation is provider-specific.

---

## Option 4 — External certbot

Run certbot outside the app and point the env vars at the resulting certs:

```bash
sudo certbot certonly --standalone -d yourdomain.com
```

Then set:
```env
ACME_CERT_DIR=/etc/letsencrypt/live
```

The app reads certs from `$ACME_CERT_DIR/<domain>/fullchain.pem` when serving TLS.

---

## Certificate storage layout

```
ACME_CERT_DIR/
  account.key           ← ACME account private key (chmod 600)
  yourdomain.com/
    fullchain.pem       ← Certificate chain (chmod 644)
    privkey.pem         ← Domain private key (chmod 600)
  otherdomain.com/
    fullchain.pem
    privkey.pem
```

Keep `ACME_CERT_DIR` on persistent storage (not a tmpfs). In Docker, mount it as a volume.

```yaml
# docker-compose.yml
services:
  app:
    volumes:
      - certs_data:/etc/certs

volumes:
  certs_data:
```

---

## Checking certificate status

```bash
# Via API
curl https://yournode.com/api/domains/7/tls-status \
  -H "Authorization: Bearer fh_your_token"

# Direct inspection
openssl x509 -in /etc/certs/yourdomain.com/fullchain.pem -noout -dates
```
