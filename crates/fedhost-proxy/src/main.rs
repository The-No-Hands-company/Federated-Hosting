/*!
 * fedhost-proxy — High-performance static site serving for Federated Hosting.
 *
 * This binary is the Rust extraction of the TypeScript host router hot path.
 * It handles every HTTP request to a hosted site domain, replacing the Node.js
 * `hostRouter` middleware for static site serving only.
 *
 * ## Architecture
 *
 * ```
 * Internet → Caddy/nginx (TLS) → fedhost-proxy (this binary) → S3/MinIO
 *                                       ↕
 *                              TypeScript API server
 *                         (auth, deploy, admin, federation)
 * ```
 *
 * The proxy operates independently of the TypeScript API server at runtime.
 * It reads the same PostgreSQL database and object storage. The TypeScript
 * server handles writes; the proxy handles reads.
 *
 * ## What this proxy does
 *
 * 1. **Domain routing** — resolves incoming Host header to a siteId via
 *    PostgreSQL, with a Redis-shared LRU cache for sub-millisecond lookups.
 *
 * 2. **Access control** — enforces site visibility (public / private / password)
 *    using the same HMAC cookie verification as the TypeScript server.
 *
 * 3. **File serving** — fetches the file's `objectPath` from PostgreSQL (cached),
 *    proxies the GET from S3/MinIO with streaming, sets correct Content-Type
 *    and Cache-Control headers.
 *
 * 4. **Analytics** — inserts into `analytics_buffer` asynchronously via a
 *    background queue; never blocks the response.
 *
 * 5. **Geo routing** — reads region headers (Fly-Region, CF-IPCountry) and
 *    optionally 302-redirects to a closer peer node.
 *
 * ## What this proxy does NOT do
 *
 * - Deploy, upload, auth, federation, admin — those stay in TypeScript.
 * - NLPL / Node.js / Python process management — TypeScript only.
 * - ACME certificate provisioning — TypeScript only.
 *
 * ## Configuration (environment variables)
 *
 * ```
 * DATABASE_URL                   PostgreSQL connection string
 * OBJECT_STORAGE_ENDPOINT        S3-compatible endpoint (or AWS default)
 * OBJECT_STORAGE_ACCESS_KEY      S3 access key
 * OBJECT_STORAGE_SECRET_KEY      S3 secret key
 * OBJECT_STORAGE_BUCKET          Bucket name
 * OBJECT_STORAGE_REGION          Region (default: auto)
 * REDIS_URL                      Optional — enables shared cache
 * COOKIE_SECRET                  HMAC secret for unlock cookies (same as TS node)
 * PROXY_LISTEN_ADDR              Bind address (default: 0.0.0.0:8090)
 * PROXY_API_URL                  TypeScript API URL for health checks
 * LOW_RESOURCE                   "true" for Raspberry Pi / small VMs
 * METRICS_LISTEN_ADDR            Prometheus scrape endpoint (default: 0.0.0.0:9091)
 * ```
 *
 * ## Running alongside the TypeScript server
 *
 * ```
 * # Start TypeScript API on :8080 as usual
 * node artifacts/api-server/dist/index.js
 *
 * # Start Rust proxy on :8090 for site serving
 * ./fedhost-proxy
 *
 * # Caddy routes:
 * # /api/* → :8080 (TypeScript)
 * # /.well-known/* → :8080 (TypeScript)
 * # everything else on site domains → :8090 (Rust proxy)
 * ```
 *
 * ## Status: SKELETON
 *
 * This file establishes the module structure, types, and interface contracts.
 * Implementation TODOs are marked with `todo!()`. The crate compiles and runs
 * but returns 501 Not Implemented until the TODOs are filled in.
 *
 * See README.md for the implementation roadmap.
 */

mod cache;
mod config;
mod db;
mod geo;
mod handler;
mod metrics;
mod storage;

use anyhow::Result;
use axum::{Router, middleware};
use std::net::SocketAddr;
use tokio::net::TcpListener;
use tracing::info;

#[tokio::main]
async fn main() -> Result<()> {
    // Initialise structured logging
    tracing_subscriber::fmt()
        .with_env_filter(
            std::env::var("RUST_LOG")
                .unwrap_or_else(|_| "fedhost_proxy=info,tower_http=warn".into()),
        )
        .json()
        .init();

    let cfg = config::Config::from_env()?;
    info!(version = env!("CARGO_PKG_VERSION"), addr = %cfg.listen_addr, "fedhost-proxy starting");

    // Shared application state
    let state = handler::AppState::new(&cfg).await?;

    // Build the router
    let app = Router::new()
        .fallback(handler::serve_site)
        .with_state(state.clone())
        .layer(metrics::metrics_layer())
        .layer(
            tower_http::trace::TraceLayer::new_for_http()
                .make_span_with(tower_http::trace::DefaultMakeSpan::new())
        );

    // Metrics endpoint on a separate port
    let metrics_addr: SocketAddr = cfg.metrics_addr.parse()?;
    tokio::spawn(metrics::serve_metrics(metrics_addr));

    // Main listener
    let listener = TcpListener::bind(&cfg.listen_addr).await?;
    info!("Listening on {}", cfg.listen_addr);

    axum::serve(listener, app).await?;
    Ok(())
}
