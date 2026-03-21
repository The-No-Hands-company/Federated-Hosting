//! LRU cache for domain → site metadata and file path → object path lookups.
//!
//! In a single-instance deployment, this is an in-process LRU.
//! When REDIS_URL is set, a Redis-backed layer is added so multiple proxy
//! instances share the same invalidation signals (sent by the TypeScript
//! API server on every deploy via `PUBLISH fedhost:cache:invalidate <siteId>`).

use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;
use std::collections::HashMap;

/// Minimal site record needed for routing and access control.
#[derive(Debug, Clone)]
pub struct CachedSite {
    pub site_id:       i32,
    pub domain:        String,
    pub visibility:    SiteVisibility,
    pub password_hash: Option<String>,
    pub site_type:     String,
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

/// Minimal file record needed for serving.
#[derive(Debug, Clone)]
pub struct CachedFile {
    pub object_path:  String,
    pub content_type: String,
    pub size_bytes:   i64,
    pub cached_at:    Instant,
}

const TTL: Duration = Duration::from_secs(300); // 5-minute TTL

/// Simple fixed-capacity LRU using insertion-order HashMap eviction.
/// Replace with the `lru` crate for production.
pub struct LruCache<K, V> {
    map:      HashMap<K, V>,
    capacity: usize,
}

impl<K: std::hash::Hash + Eq + Clone, V> LruCache<K, V> {
    pub fn new(capacity: usize) -> Self {
        Self { map: HashMap::with_capacity(capacity.min(1024)), capacity }
    }

    pub fn get(&self, key: &K) -> Option<&V> {
        self.map.get(key)
    }

    pub fn insert(&mut self, key: K, value: V) {
        if self.map.len() >= self.capacity {
            // Simple eviction: remove the first key (not true LRU — use `lru` crate in prod)
            if let Some(k) = self.map.keys().next().cloned() {
                self.map.remove(&k);
            }
        }
        self.map.insert(key, value);
    }

    pub fn remove(&mut self, key: &K) {
        self.map.remove(key);
    }
}

pub struct DomainCache {
    inner: Arc<RwLock<LruCache<String, CachedSite>>>,
}

impl DomainCache {
    pub fn new(capacity: usize) -> Self {
        Self { inner: Arc::new(RwLock::new(LruCache::new(capacity))) }
    }

    pub async fn get(&self, domain: &str) -> Option<CachedSite> {
        let guard = self.inner.read().await;
        guard.get(&domain.to_string()).and_then(|entry| {
            if entry.cached_at.elapsed() < TTL { Some(entry.clone()) } else { None }
        })
    }

    pub async fn insert(&self, site: CachedSite) {
        let mut guard = self.inner.write().await;
        guard.insert(site.domain.clone(), site);
    }

    pub async fn invalidate_site(&self, site_id: i32) {
        let mut guard = self.inner.write().await;
        // Find all domains pointing to this site and remove them
        let keys: Vec<String> = guard.map.iter()
            .filter(|(_, v)| v.site_id == site_id)
            .map(|(k, _)| k.clone())
            .collect();
        for k in keys { guard.remove(&k); }
    }
}

pub struct FileCache {
    inner: Arc<RwLock<LruCache<String, CachedFile>>>,
}

impl FileCache {
    pub fn new(capacity: usize) -> Self {
        Self { inner: Arc::new(RwLock::new(LruCache::new(capacity))) }
    }

    pub fn key(site_id: i32, file_path: &str) -> String {
        format!("{}:{}", site_id, file_path)
    }

    pub async fn get(&self, site_id: i32, file_path: &str) -> Option<CachedFile> {
        let guard = self.inner.read().await;
        guard.get(&Self::key(site_id, file_path)).and_then(|e| {
            if e.cached_at.elapsed() < TTL { Some(e.clone()) } else { None }
        })
    }

    pub async fn insert(&self, site_id: i32, file_path: &str, file: CachedFile) {
        let mut guard = self.inner.write().await;
        guard.insert(Self::key(site_id, file_path), file);
    }
}
