//! LRU caches for domain → site metadata and file path → object path.
//!
//! ## Two-level caching
//!
//! - In-process `lru::LruCache` behind a `RwLock` — zero network overhead
//! - Optional Redis layer for cache invalidation signals across multiple proxy
//!   instances (subscribe to `fedhost:cache:invalidate <siteId>` channel)
//!
//! ## Invalidation
//!
//! The TypeScript API server publishes a Redis PUBLISH whenever a site is
//! deployed or settings change:
//!   `PUBLISH fedhost:cache:invalidate <siteId>`
//!
//! The Redis subscriber (TODO #4) calls `invalidate_site()` on both caches.

use std::num::NonZeroUsize;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;
use lru::LruCache;

/// How long a cached entry remains valid before a DB re-check.
const TTL: Duration = Duration::from_secs(300); // 5 minutes — matches TypeScript

/// Minimal site record for routing and access control.
#[derive(Debug, Clone)]
pub struct CachedSite {
    pub site_id:       i32,
    pub domain:        String,
    pub visibility:    SiteVisibility,
    pub password_hash: Option<String>,
    pub site_type:     String,
    /// Serve index.html for unknown paths (SPA). Default: true.
    pub spa_routing:   bool,
    pub cached_at:     Instant,
}

#[derive(Debug, Clone, PartialEq)]
pub enum SiteVisibility {
    Public,
    Private,
    Password,
}

impl From<&str> for SiteVisibility {
    fn from(s: &str) -> Self {
        match s {
            "private"  => Self::Private,
            "password" => Self::Password,
            _          => Self::Public,
        }
    }
}

/// Minimal file record for serving.
#[derive(Debug, Clone)]
pub struct CachedFile {
    pub object_path:  String,
    pub content_type: String,
    pub size_bytes:   i64,
    pub cached_at:    Instant,
}

// ── Domain cache ──────────────────────────────────────────────────────────────

pub struct DomainCache {
    inner: Arc<RwLock<LruCache<String, CachedSite>>>,
}

impl DomainCache {
    pub fn new(capacity: usize) -> Self {
        let cap = NonZeroUsize::new(capacity.max(1)).expect("capacity > 0");
        Self { inner: Arc::new(RwLock::new(LruCache::new(cap))) }
    }

    pub async fn get(&self, domain: &str) -> Option<CachedSite> {
        let mut guard = self.inner.write().await; // write for LRU ordering
        guard.get(domain).and_then(|e| {
            if e.cached_at.elapsed() < TTL { Some(e.clone()) } else { None }
        })
    }

    pub async fn insert(&self, site: CachedSite) {
        let mut guard = self.inner.write().await;
        guard.put(site.domain.clone(), site);
    }

    /// Remove all entries for a site (called on deploy / settings change).
    pub async fn invalidate_site(&self, site_id: i32) {
        let mut guard = self.inner.write().await;
        // lru crate doesn't support predicate removal — collect keys first
        let keys: Vec<String> = guard.iter()
            .filter(|(_, v)| v.site_id == site_id)
            .map(|(k, _)| k.clone())
            .collect();
        for k in keys { guard.pop(&k); }
    }

    pub async fn len(&self) -> usize {
        self.inner.read().await.len()
    }
}

// ── File cache ────────────────────────────────────────────────────────────────

pub struct FileCache {
    inner: Arc<RwLock<LruCache<String, CachedFile>>>,
}

impl FileCache {
    pub fn new(capacity: usize) -> Self {
        let cap = NonZeroUsize::new(capacity.max(1)).expect("capacity > 0");
        Self { inner: Arc::new(RwLock::new(LruCache::new(cap))) }
    }

    pub fn key(site_id: i32, file_path: &str) -> String {
        format!("{}:{}", site_id, file_path)
    }

    pub async fn get(&self, site_id: i32, file_path: &str) -> Option<CachedFile> {
        let mut guard = self.inner.write().await;
        guard.get(&Self::key(site_id, file_path)).and_then(|e| {
            if e.cached_at.elapsed() < TTL { Some(e.clone()) } else { None }
        })
    }

    pub async fn insert(&self, site_id: i32, file_path: &str, file: CachedFile) {
        let mut guard = self.inner.write().await;
        guard.put(Self::key(site_id, file_path), file);
    }

    /// Remove all file entries for a site (called on deploy).
    pub async fn invalidate_site(&self, site_id: i32) {
        let mut guard = self.inner.write().await;
        let keys: Vec<String> = guard.iter()
            .filter(|(k, _)| k.starts_with(&format!("{}:", site_id)))
            .map(|(k, _)| k.clone())
            .collect();
        for k in keys { guard.pop(&k); }
    }

    pub async fn len(&self) -> usize {
        self.inner.read().await.len()
    }
}
