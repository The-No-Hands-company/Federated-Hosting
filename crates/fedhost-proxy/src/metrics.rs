//! Prometheus metrics.
//!
//! Mirrors the TypeScript `metrics.ts` counters/histograms so both
//! the Node.js API server and the Rust proxy can be scraped together.

use axum::{Router, routing::get, response::IntoResponse};
use std::net::SocketAddr;
use tower::ServiceBuilder;

pub fn metrics_layer() -> tower::layer::util::Identity {
    // TODO: integrate metrics-exporter-prometheus
    // For now return identity layer (no-op)
    tower::layer::util::Identity::new()
}

pub async fn serve_metrics(addr: SocketAddr) {
    let app = Router::new().route("/metrics", get(metrics_handler));
    if let Ok(listener) = tokio::net::TcpListener::bind(addr).await {
        tracing::info!("Metrics on {addr}");
        let _ = axum::serve(listener, app).await;
    }
}

async fn metrics_handler() -> impl IntoResponse {
    // TODO: return prometheus text format from metrics registry
    "# fedhost-proxy metrics — TODO\n"
}
