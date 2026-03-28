# ─── Stage 1: install workspace deps ─────────────────────────────────────────
FROM node:24-alpine AS deps

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy workspace manifests first for layer caching
COPY pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY package.json ./
COPY lib/db/package.json                    ./lib/db/
COPY lib/api-spec/package.json              ./lib/api-spec/
COPY lib/api-client-react/package.json      ./lib/api-client-react/
COPY lib/api-zod/package.json               ./lib/api-zod/
COPY lib/replit-auth-web/package.json       ./lib/replit-auth-web/
COPY lib/object-storage-web/package.json    ./lib/object-storage-web/
COPY artifacts/api-server/package.json      ./artifacts/api-server/
COPY artifacts/nexus-hosting/package.json ./artifacts/nexus-hosting/

RUN pnpm install --frozen-lockfile

# ─── Stage 2: build everything ────────────────────────────────────────────────
FROM deps AS builder

WORKDIR /app

COPY . .

# Build shared libs
RUN pnpm --filter @workspace/db          run build 2>/dev/null || true
RUN pnpm --filter @workspace/api-zod     run build 2>/dev/null || true

# Build API server
RUN pnpm --filter @workspace/api-server  run build

# Build frontend
RUN pnpm --filter @workspace/nexus-hosting run build

# ─── Stage 3: production image ────────────────────────────────────────────────
FROM node:24-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Only copy the bundled artefacts — no source, no dev deps
COPY --from=builder /app/artifacts/api-server/dist         ./dist
COPY --from=builder /app/artifacts/nexus-hosting/dist  ./public

# A minimal package.json so Node can resolve the bundle
COPY --from=builder /app/artifacts/api-server/package.json ./package.json

# Non-root user for security
RUN addgroup -S fhnode && adduser -S fhnode -G fhnode
USER fhnode

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:8080/api/health/live || exit 1

CMD ["node", "dist/index.js"]
