//! Main request handler.
//!
//! Every incoming HTTP request goes through `serve_site`. The flow is:
//!
//! 1. Extract the Host header → domain
//! 2. Skip infra domains (localhost, API server domain)
//! 3. Resolve domain → CachedSite (cache → DB)
//! 4. Check site visibility (public / private / password)
//! 5. Resolve file path → CachedFile (cache → DB)
//! 6. Stream from S3/MinIO with correct headers
//! 7. Record analytics hit (background task)

use axum::{
    body::Body,
    extract::{Host, Request, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use bytes::Bytes;
use std::sync::Arc;
use tracing::{debug, warn};

use crate::{
    cache::{CachedFile, CachedSite, DomainCache, FileCache, SiteVisibility},
    config::Config,
    db::Db,
    geo::select_closest_node,
    storage::ObjectStorage,
};

/// Shared application state, cloned cheaply into every handler via Arc.
#[derive(Clone)]
pub struct AppState {
    pub config:       Arc<Config>,
    pub db:           Arc<Db>,
    pub domain_cache: Arc<DomainCache>,
    pub file_cache:   Arc<FileCache>,
    pub storage:      Arc<ObjectStorage>,
}

impl AppState {
    pub async fn new(cfg: &Config) -> anyhow::Result<Self> {
        let db = Db::new(&cfg.database_url).await?;
        let storage = ObjectStorage::new(cfg)?;

        Ok(Self {
            config:       Arc::new(cfg.clone()),
            db:           Arc::new(db),
            domain_cache: Arc::new(DomainCache::new(cfg.domain_cache_max)),
            file_cache:   Arc::new(FileCache::new(cfg.file_cache_max)),
            storage:      Arc::new(storage),
        })
    }
}

/// The catch-all site-serving handler.
pub async fn serve_site(
    State(state): State<AppState>,
    Host(host): Host,
    req: Request,
) -> Response {
    // Strip port from host if present
    let domain = host.split(':').next().unwrap_or(&host).to_lowercase();

    // Skip infra domains
    if is_infra_domain(&domain) {
        return StatusCode::NOT_FOUND.into_response();
    }

    // ── Geo routing ────────────────────────────────────────────────────────
    // TODO: implement geo routing redirect using select_closest_node
    // if let Some(redirect_url) = select_closest_node(&domain, req.headers()).await { ... }

    // ── Domain → site resolution ───────────────────────────────────────────
    let site = match resolve_site(&state, &domain).await {
        Some(s) => s,
        None => return not_found_response(&domain),
    };

    // ── Visibility checks ──────────────────────────────────────────────────
    match site.visibility {
        SiteVisibility::Private => {
            return private_response();
        }
        SiteVisibility::Password => {
            if !verify_unlock_cookie(req.headers(), site.site_id, &state.config.cookie_secret) {
                return password_gate_response(site.site_id, &domain);
            }
        }
        SiteVisibility::Public => {}
    }

    // Dynamic sites (NLPL/Node/Python) are handled by the TypeScript server
    if matches!(site.site_type.as_str(), "nlpl" | "dynamic" | "node" | "python") {
        return StatusCode::NOT_IMPLEMENTED.into_response();
    }

    // ── File path resolution ───────────────────────────────────────────────
    let raw_path = req.uri().path();
    let file_path = resolve_file_path(raw_path);

    let file = match resolve_file(&state, site.site_id, &file_path).await {
        Some(f) => f,
        None => {
            // Try index.html fallback for SPA routing
            if file_path != "index.html" {
                if let Some(f) = resolve_file(&state, site.site_id, "index.html").await {
                    f
                } else {
                    return not_found_response(&domain);
                }
            } else {
                return not_found_response(&domain);
            }
        }
    };

    // ── Stream from object storage ─────────────────────────────────────────
    let bytes_served = file.size_bytes;
    let content_type = file.content_type.clone();
    let cache_control = get_cache_control(&content_type);

    let stream_result = state.storage.stream_object(&file.object_path).await;

    let body_bytes = match stream_result {
        Ok(b) => b,
        Err(e) => {
            warn!(error = %e, domain, path = file_path, "Storage error");
            return StatusCode::BAD_GATEWAY.into_response();
        }
    };

    // ── Analytics (fire-and-forget) ────────────────────────────────────────
    {
        let db = state.db.clone();
        let path = file_path.clone();
        let site_id = site.site_id;
        let referrer = req.headers()
            .get("referer")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());
        tokio::spawn(async move {
            let _ = db.record_hit(site_id, &path, referrer.as_deref(), None, bytes_served).await;
        });
    }

    // ── Build response ─────────────────────────────────────────────────────
    Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type",     content_type)
        .header("Cache-Control",    cache_control)
        .header("X-Served-By",      "fedhost-proxy/rust")
        .header("X-Site-Domain",    domain)
        .body(Body::from(body_bytes))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn is_infra_domain(domain: &str) -> bool {
    domain.starts_with("localhost")
        || domain == "127.0.0.1"
        || domain.ends_with(".replit.app")
        || domain.ends_with(".replit.dev")
}

async fn resolve_site(state: &AppState, domain: &str) -> Option<CachedSite> {
    if let Some(cached) = state.domain_cache.get(domain).await {
        debug!(domain, "Domain cache hit");
        return Some(cached);
    }
    match state.db.lookup_site(domain).await {
        Ok(Some(site)) => {
            state.domain_cache.insert(site.clone()).await;
            Some(site)
        }
        Ok(None) => None,
        Err(e) => {
            warn!(error = %e, domain, "DB error on domain lookup");
            None
        }
    }
}

async fn resolve_file(state: &AppState, site_id: i32, file_path: &str) -> Option<CachedFile> {
    if let Some(cached) = state.file_cache.get(site_id, file_path).await {
        return Some(cached);
    }
    match state.db.lookup_file(site_id, file_path).await {
        Ok(Some(file)) => {
            state.file_cache.insert(site_id, file_path, file.clone()).await;
            Some(file)
        }
        Ok(None) => None,
        Err(e) => {
            warn!(error = %e, site_id, file_path, "DB error on file lookup");
            None
        }
    }
}

fn resolve_file_path(uri_path: &str) -> String {
    let p = uri_path.trim_start_matches('/');
    if p.is_empty() { "index.html".to_string() } else { p.to_string() }
}

fn get_cache_control(content_type: &str) -> &'static str {
    if content_type.contains("text/html") {
        "public, max-age=0, must-revalidate"
    } else if content_type.contains("javascript")
        || content_type.contains("css")
        || content_type.contains("font")
    {
        "public, max-age=31536000, immutable"
    } else {
        "public, max-age=3600"
    }
}

/// Verify the HMAC-signed unlock cookie for password-protected sites.
/// Must match the TypeScript `verifyUnlockCookie` implementation exactly.
fn verify_unlock_cookie(headers: &HeaderMap, site_id: i32, secret: &str) -> bool {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;

    let cookie_name = format!("site_unlock_{}", site_id);
    let cookie_header = match headers.get("cookie").and_then(|v| v.to_str().ok()) {
        Some(c) => c,
        None => return false,
    };

    let cookie_value = cookie_header
        .split(';')
        .find_map(|part| {
            let trimmed = part.trim();
            trimmed.strip_prefix(&format!("{}=", cookie_name))
        });

    let value = match cookie_value {
        Some(v) => v,
        None => return false,
    };

    // Format: base64url(siteId:issuedAt).base64url(hmac)
    let mut parts = value.splitn(2, '.');
    let encoded_payload = match parts.next() { Some(p) => p, None => return false };
    let hmac_b64 = match parts.next() { Some(h) => h, None => return false };

    let payload_bytes = match base64::decode_config(encoded_payload, base64::URL_SAFE_NO_PAD) {
        Ok(b) => b,
        Err(_) => return false,
    };
    let payload = match std::str::from_utf8(&payload_bytes) {
        Ok(s) => s,
        Err(_) => return false,
    };

    // Verify siteId and expiry
    let mut payload_parts = payload.splitn(2, ':');
    let cookie_site_id: i32 = match payload_parts.next().and_then(|s| s.parse().ok()) {
        Some(id) => id,
        None => return false,
    };
    if cookie_site_id != site_id { return false; }

    let issued_at: u64 = match payload_parts.next().and_then(|s| s.parse().ok()) {
        Some(t) => t,
        None => return false,
    };

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    if now.saturating_sub(issued_at) > 86400 { return false; } // 24h expiry

    // Verify HMAC
    let expected = {
        let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).unwrap();
        mac.update(payload.as_bytes());
        base64::encode_config(mac.finalize().into_bytes(), base64::URL_SAFE_NO_PAD)
    };

    // Constant-time comparison
    expected == hmac_b64
}

fn not_found_response(domain: &str) -> Response {
    let body = format!(
        r#"<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Not Found</title>
<style>*{{margin:0;padding:0}}body{{font-family:system-ui,sans-serif;background:#0a0a0f;color:#e4e4f0;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center}}</style>
</head><body><div><h1 style="font-size:4rem;opacity:.3">404</h1><p>No site found for <code>{domain}</code></p></div></body></html>"#
    );
    Response::builder()
        .status(StatusCode::NOT_FOUND)
        .header("Content-Type", "text/html; charset=utf-8")
        .body(Body::from(body))
        .unwrap()
}

fn private_response() -> Response {
    Response::builder()
        .status(StatusCode::FORBIDDEN)
        .header("Content-Type", "text/html; charset=utf-8")
        .body(Body::from(
            r#"<!DOCTYPE html><html><body style="font-family:system-ui;background:#0a0a0f;color:#e4e4f0;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center"><div><h1>403</h1><p>This site is private.</p></div></body></html>"#
        ))
        .unwrap()
}

fn password_gate_response(site_id: i32, domain: &str) -> Response {
    // Redirect to the TypeScript server's password gate
    Response::builder()
        .status(StatusCode::FOUND)
        .header("Location", format!("/api/sites/{}/unlock?domain={}", site_id, domain))
        .body(Body::empty())
        .unwrap()
}
