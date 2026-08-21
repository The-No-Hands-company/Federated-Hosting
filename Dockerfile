# ─── Stage 1: install workspace deps ─────────────────────────────────────────
FROM node:24-alpine AS deps

WORKDIR /app

# Install pnpm
# Pinned, not @latest: an unpinned package manager means the image changes
# meaning over time.
#
# This pin was 9.15.9, and that was right when it was written — the overrides
# lived under "pnpm" in package.json, which pnpm 10 stopped reading, so @latest
# silently dropped them and every build failed ERR_PNPM_LOCKFILE_CONFIG_MISMATCH
# against its own lockfile.
#
# What changed: the overrides have since moved to pnpm-workspace.yaml, where
# pnpm 10+ expects them, and the lockfile was regenerated from there by a newer
# pnpm on the host. That inverted the problem. pnpm 9 does not read overrides
# from pnpm-workspace.yaml at all — nor onlyBuiltDependencies, minimumReleaseAge
# or allowBuilds, all of which this workspace now uses — so it saw a lockfile
# declaring overrides nothing explained and refused, with the same error the old
# pin existed to prevent. The image had been unbuildable ever since.
#
# So: forward, not back. Kept in step with the packageManager field in
# package.json, which is where corepack looks and is what stops these two
# drifting apart again.
RUN corepack enable && corepack prepare pnpm@11.21.0 --activate

# pnpm 10+ re-syncs node_modules before running a workspace script, and asks
# before purging a modules directory it did not create. A docker build has no
# TTY to ask, so it aborts: ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY. pnpm's
# own message names the fix — this is a CI environment, and saying so is more
# honest than disabling the safety check.
ENV CI=true

# Copy workspace manifests first for layer caching
COPY pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY package.json ./
COPY lib/db/package.json                    ./lib/db/
COPY lib/api-spec/package.json              ./lib/api-spec/
COPY lib/api-client-react/package.json      ./lib/api-client-react/
COPY lib/api-zod/package.json               ./lib/api-zod/
COPY lib/auth-web/package.json       ./lib/auth-web/
COPY lib/object-storage-web/package.json    ./lib/object-storage-web/
COPY artifacts/api-server/package.json      ./artifacts/api-server/
COPY artifacts/federated-hosting/package.json ./artifacts/federated-hosting/

RUN pnpm install --frozen-lockfile

# ─── Stage 2: build everything ────────────────────────────────────────────────
FROM deps AS builder

WORKDIR /app

COPY . .

# Build shared libs
# These two publish the declaration files api-server typechecks against. They
# had no build script until 2026-08-21, so `|| true` was quietly swallowing a
# no-op and `2>/dev/null` was hiding it — which is why the first build with a
# typecheck gate failed with 72 TS6305 "has not been built" errors. api-server's
# build now builds its own references too, so this is belt and braces; the
# suppression is gone either way, because a failure here should be visible.
RUN pnpm --filter @workspace/db          run build
RUN pnpm --filter @workspace/api-zod     run build

# Build API server
RUN pnpm --filter @workspace/api-server  run build


# Build frontend
RUN pnpm --filter @workspace/nexus-hosting run build

# Ordered after every build, not before. `deploy --prod` resolves a
# production-only tree, and running it first left the workspace in a state
# pnpm 10+ re-syncs before the next script — which dropped the dev
# dependencies the frontend build needs and failed with `vite: not found`.
# Producing the runtime tree last is the natural order regardless: build
# everything, then take what production needs.
# Production node_modules for the runner. The bundle is not self-contained:
# build.ts bundles only a 7-package allowlist and marks the other 33 dependencies
# external, so the runtime needs them on disk. Bundling @aws-sdk and the Express
# middleware instead would be far more fragile. `pnpm deploy` resolves a
# workspace package into a standalone tree with prod dependencies only.
# --legacy: from pnpm 10, `deploy` refuses a workspace that is not "injected"
# (ERR_PNPM_DEPLOY_NONINJECTED_WORKSPACE) and wants inject-workspace-packages=true.
# Setting that would change how every workspace dependency is linked — copied
# rather than symlinked — for local development as well as this image, which is
# a much larger change than restoring a build. --legacy runs the previous
# implementation, which is what this Dockerfile was written against and what the
# running image was built with. Moving to injected workspaces is worth doing
# deliberately, on its own, with the whole workspace tested.
RUN pnpm --filter @workspace/api-server deploy --legacy --prod /app/prod-deps

# ─── Stage 3: production image ────────────────────────────────────────────────
FROM node:24-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Only copy the bundled artefacts — no source, no dev deps
COPY --from=builder /app/artifacts/api-server/dist         ./dist
COPY --from=builder /app/artifacts/federated-hosting/dist  ./public

# A minimal package.json so Node can resolve the bundle
# The enrolment installer. It cannot go in ./public — that path is the client
# build, copied above — so it gets its own directory that app.ts also looks in.
COPY artifacts/api-server/public/install-node.sh ./installer/install-node.sh

COPY --from=builder /app/artifacts/api-server/package.json ./package.json
COPY --from=builder /app/prod-deps/node_modules ./node_modules

# Non-root user for security
RUN addgroup -S fhnode && adduser -S fhnode -G fhnode
USER fhnode

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:8080/api/health/live || exit 1

# index.cjs, not index.js — build.ts sets outfile to dist/index.cjs, so the
# container started and immediately died with MODULE_NOT_FOUND.
CMD ["node", "dist/index.cjs"]
