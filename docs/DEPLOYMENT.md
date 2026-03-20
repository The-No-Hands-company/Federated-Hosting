# Deployment Guide

This guide covers running a Federated Hosting node in production.

---

## Requirements

| Dependency | Minimum version | Notes |
|------------|----------------|-------|
| Node.js | 24 | Native Ed25519 in `crypto`; native `fetch` |
| pnpm | 10 | Monorepo package manager |
| PostgreSQL | 15 | Any hosted provider works |
| Object storage | S3-compatible | S3-compatible object storage, AWS S3, Cloudflare R2, etc. |

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `DEFAULT_OBJECT_STORAGE_BUCKET_ID` | Yes | Object storage bucket ID |
| `PRIVATE_OBJECT_DIR` | Yes | Prefix for private uploads (e.g. `private`) |
| `PUBLIC_OBJECT_SEARCH_PATHS` | Yes | Prefix for public objects (e.g. `public`) |
| `NODE_ENV` | No | Set to `production` for structured JSON logs + no stack traces |
| `PORT` | No | API server port (default: `8080`) |

---

## Initial Setup

### 1. Install dependencies

```bash
pnpm install --frozen-lockfile
```

### 2. Push database schema

```bash
pnpm --filter @workspace/db run push
```

This creates all tables and indexes. Safe to run repeatedly — it will not drop existing data.

### 3. Start the API server

```bash
pnpm --filter @workspace/api-server run start
```

On startup, the server will automatically:
- Check for an existing local node record
- If none exists, create one with an auto-generated Ed25519 key pair
- Log the node domain and ID

### 4. (Optional) Start the frontend

```bash
pnpm --filter @workspace/federated-hosting run build
# Then serve the dist/ folder with nginx, Caddy, or any static host
```

Or for a combined deployment, the API server can serve the built frontend from its static middleware.

---

## Health Checks

Configure your load balancer or orchestration platform to probe:

| Endpoint | Use |
|----------|-----|
| `GET /api/health/live` | Liveness — restart if this fails |
| `GET /api/health/ready` | Readiness — only route traffic when this passes |

Both return HTTP 200 on success and a JSON body.

---

## Reverse Proxy (nginx)

The API server must receive the original `Host` header for host-header site routing to work. Configure nginx:

```nginx
server {
    listen 443 ssl;
    server_name _;

    ssl_certificate     /etc/ssl/certs/cert.pem;
    ssl_certificate_key /etc/ssl/private/key.pem;

    # Pass the real Host header (required for federated site routing)
    proxy_set_header Host              $host;
    proxy_set_header X-Forwarded-For  $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host  $host;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

---

## Wildcard DNS (for site hosting)

To serve all hosted sites on `*.yourdomain.com`, point a wildcard DNS record to your node:

```
*.yourdomain.com  A  <your-node-ip>
```

When a browser visits `my-blog.yourdomain.com`, the `Host` header is picked up by the host-header router, which looks up the registered site and streams the files.

---

## Joining the Federation Network

After your node is running:

1. **Share your discovery URL** with other operators: `https://your-node.com/.well-known/federation`

2. **Register their node** in your database via the API:
   ```bash
   curl -X POST https://your-node.com/api/nodes \
     -H "Content-Type: application/json" \
     -d '{ "name": "Peer Node", "domain": "peer.example.com", "region": "eu-west" }'
   ```

3. **Initiate a handshake**:
   ```bash
   curl -X POST https://your-node.com/api/federation/handshake \
     -H "Content-Type: application/json" \
     -d '{ "targetNodeUrl": "https://peer.example.com" }'
   ```

4. Ask the peer operator to do the same in reverse for mutual verification.

---

## Scaling

The API server is **stateless** — sessions are stored in PostgreSQL. You can run multiple API server instances behind a load balancer.

For high-traffic nodes:

- Add a **read replica** to PostgreSQL and route `SELECT` queries to it
- Put a **CDN** (Cloudflare, Fastly) in front for static file caching
- Consider a **dedicated object storage region** co-located with your API servers to reduce latency

---

## Log Management

In `NODE_ENV=production`, logs are emitted as newline-delimited JSON (pino). Pipe them to your log aggregator:

```bash
pnpm --filter @workspace/api-server run start | your-log-shipper
```

Fields present in every request log:
- `requestId` — UUID (also in `X-Request-ID` response header)
- `method`, `url`, `statusCode`, `responseTime`
- `level` — `info`, `warn`, `error`, `fatal`

Fields that are **always redacted**: `privateKey`, `password`

---

## Graceful Shutdown

The server handles `SIGTERM` and `SIGINT` by:

1. Stopping acceptance of new connections
2. Waiting for in-flight requests to complete (up to 10 seconds)
3. Closing the PostgreSQL connection pool
4. Exiting with code `0`

This means you can safely deploy new versions with a rolling restart (`kill -SIGTERM <pid>`) without dropping requests.

---

## Updating

```bash
git pull origin main
pnpm install --frozen-lockfile
pnpm --filter @workspace/db run push   # safe to run; applies any new indexes/columns
# Restart the API server (SIGTERM for graceful drain)
```
