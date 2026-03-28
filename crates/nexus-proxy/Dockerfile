# Multi-stage build for nexus-proxy
#
# Stage 1: Build the Rust binary
# Stage 2: Minimal runtime image (~20 MB)

# ── Builder ───────────────────────────────────────────────────────────────────
FROM rust:1.78-slim-bookworm AS builder

# Install system deps needed for SSL and PostgreSQL
RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Cache dependencies — copy manifests first, then source
COPY Cargo.toml Cargo.lock ./
RUN mkdir -p src && echo "fn main() {}" > src/main.rs
RUN cargo build --release 2>/dev/null; rm src/main.rs

# Build the real binary
COPY src ./src
RUN touch src/main.rs && cargo build --release

# ── Runtime ───────────────────────────────────────────────────────────────────
FROM debian:bookworm-slim AS runner

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Non-root user for security
RUN useradd -r -s /bin/false -u 1001 nexus

COPY --from=builder /build/target/release/nexus-proxy /usr/local/bin/nexus-proxy

USER nexus

EXPOSE 8090 9091

ENTRYPOINT ["/usr/local/bin/nexus-proxy"]
