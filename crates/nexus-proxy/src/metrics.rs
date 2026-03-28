//! Prometheus metrics for nexus-proxy.
//!
//! Exposes a /metrics endpoint on a separate port (METRICS_LISTEN_ADDR).
//! Metric names mirror the TypeScript metricsCollector.ts so Grafana
//! dashboards work with both the TS API server and the Rust proxy.

use axum::{Router, routing::get, response::IntoResponse, http::StatusCode};
use metrics::{counter, histogram, gauge};
use metrics_exporter_prometheus::{PrometheusBuilder, PrometheusHandle};
use std::net::SocketAddr;
use std::time::Duration;

/// Install the Prometheus recorder globally and return the scrape handle.
///
/// Must be called once at startup before any metrics are recorded.
pub fn install_recorder() -> PrometheusHandle {
    PrometheusBuilder::new()
        .install_recorder()
        .expect("Failed to install Prometheus recorder")
}

/// Returns an identity layer — metrics are recorded inline in serve_site().
/// The tower layer approach requires boxing which adds overhead on the hot path.
pub fn metrics_layer() -> tower::layer::util::Identity {
    tower::layer::util::Identity::new()
}

/// Record a completed request — called from serve_site() after response is built.
pub fn record_request(
    method:       &str,
    status:       u16,
    content_type: &str,
    duration:     Duration,
    bytes_served: i64,
) {
    counter!(
        "nexus_proxy_requests_total",
        "method"       => method.to_string(),
        "status"       => status.to_string(),
        "content_type" => simplify_content_type(content_type),
    ).increment(1);

    histogram!(
        "nexus_proxy_request_duration_seconds",
        "method" => method.to_string(),
    ).record(duration.as_secs_f64());

    if bytes_served > 0 {
        counter!("nexus_proxy_bytes_served_total").increment(bytes_served as u64);
    }
}

/// Record a cache hit or miss.
pub fn record_cache_event(cache: &str, hit: bool) {
    if hit {
        counter!("nexus_proxy_cache_hits_total",   "cache" => cache.to_string()).increment(1);
    } else {
        counter!("nexus_proxy_cache_misses_total", "cache" => cache.to_string()).increment(1);
    }
}

/// Update current cache sizes (call periodically or on insert/evict).
pub fn record_cache_sizes(domain_size: usize, file_size: usize) {
    gauge!("nexus_proxy_domain_cache_size").set(domain_size as f64);
    gauge!("nexus_proxy_file_cache_size").set(file_size as f64);
}

/// Record a storage fetch.
pub fn record_storage_fetch(success: bool, duration: Duration) {
    counter!(
        "nexus_proxy_storage_fetches_total",
        "result" => if success { "success" } else { "error" }
    ).increment(1);

    histogram!("nexus_proxy_storage_fetch_duration_seconds")
        .record(duration.as_secs_f64());
}

/// Record a geo-routing redirect.
pub fn record_geo_redirect(from_region: &str, to_region: &str) {
    counter!(
        "nexus_proxy_geo_redirects_total",
        "from" => from_region.to_string(),
        "to"   => to_region.to_string(),
    ).increment(1);
}

/// Record a blocklist rejection.
pub fn record_blocked_request() {
    counter!("nexus_proxy_blocked_requests_total").increment(1);
}

/// Serve Prometheus metrics on the dedicated port.
///
/// The handle is produced by `install_recorder()` — pass it in here.
pub async fn serve_metrics(addr: SocketAddr, handle: PrometheusHandle) {
    let render = move || {
        let output = handle.render();
        (StatusCode::OK, [("Content-Type", "text/plain; version=0.0.4")], output)
    };

    let app = Router::new().route("/metrics", get(render));

    if let Ok(listener) = tokio::net::TcpListener::bind(addr).await {
        tracing::info!("Prometheus metrics on {addr}");
        let _ = axum::serve(listener, app).await;
    } else {
        tracing::warn!("Failed to bind metrics addr {addr}");
    }
}

fn simplify_content_type(ct: &str) -> &'static str {
    if ct.contains("text/html")       { return "html"; }
    if ct.contains("javascript")      { return "js"; }
    if ct.contains("text/css")        { return "css"; }
    if ct.contains("image/")          { return "image"; }
    if ct.contains("font/")           { return "font"; }
    if ct.contains("application/json"){ return "json"; }
    "other"
}
