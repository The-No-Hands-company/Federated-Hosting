//! Read-only PostgreSQL access.
//!
//! The proxy only ever reads from the database — writes happen exclusively
//! through the TypeScript API server. Two queries cover all hot-path needs:
//!
//! 1. `lookup_site(domain)` — resolve domain → site metadata
//! 2. `lookup_file(site_id, file_path)` — resolve file → objectPath
//!
//! Both are cached in-process (and optionally in Redis). Database hits only
//! occur on cache misses or TTL expiry.
//!
//! ## Pool sizing
//!
//! Normal mode: max 10 connections (proxy is read-only; TypeScript owns the rest).
//! LOW_RESOURCE: max 3 connections.

use anyhow::Result;
use deadpool_postgres::{Config as PgConfig, Pool, Runtime, PoolConfig};
use tokio_postgres::NoTls;

use crate::cache::{CachedFile, CachedSite, SiteVisibility};
use crate::config::Config;

/// Max pool connections for the Rust proxy.
/// TypeScript server uses up to 20; proxy is read-only so we cap lower.
const POOL_MAX_NORMAL: usize = 10;
const POOL_MAX_LOW_RESOURCE: usize = 3;

pub struct Db {
    pool: Pool,
}

impl Db {
    pub async fn new(cfg: &Config) -> Result<Self> {
        let mut pg_cfg = PgConfig::new();
        pg_cfg.url = Some(cfg.database_url.clone());

        // Pool sizing respects LOW_RESOURCE mode
        let max_size = if cfg.low_resource { POOL_MAX_LOW_RESOURCE } else { POOL_MAX_NORMAL };
        pg_cfg.pool = Some(PoolConfig {
            max_size,
            ..Default::default()
        });

        let pool = pg_cfg.create_pool(Some(Runtime::Tokio1), NoTls)?;

        // Verify connectivity at startup
        {
            let conn = pool.get().await?;
            conn.execute("SELECT 1", &[]).await?;
        }

        tracing::info!(max_size, low_resource = cfg.low_resource, "DB pool ready");
        Ok(Self { pool })
    }

    /// Resolve a domain to site metadata.
    ///
    /// Checks `sites.domain` first (primary domain), then `custom_domains`
    /// (verified custom domains). Returns None if no site is found.
    pub async fn lookup_site(&self, domain: &str) -> Result<Option<CachedSite>> {
        let conn = self.pool.get().await?;

        // Try primary domain first
        let row = conn
            .query_opt(
                r#"
                SELECT id, domain, visibility, password_hash, site_type, spa_routing
                FROM sites
                WHERE domain = $1
                  AND status = 'active'
                "#,
                &[&domain],
            )
            .await?;

        if let Some(r) = row {
            return Ok(Some(CachedSite {
                site_id:       r.get::<_, i32>("id"),
                domain:        r.get::<_, String>("domain"),
                visibility:    SiteVisibility::from(r.get::<_, &str>("visibility")),
                password_hash: r.get::<_, Option<String>>("password_hash"),
                site_type:     r.get::<_, String>("site_type"),
                spa_routing:   r.get::<_, i32>("spa_routing") != 0,
                cached_at:     std::time::Instant::now(),
            }));
        }

        // Try custom domain
        let row = conn
            .query_opt(
                r#"
                SELECT s.id, s.domain, s.visibility, s.password_hash, s.site_type, s.spa_routing
                FROM custom_domains cd
                JOIN sites s ON s.id = cd.site_id
                WHERE cd.domain = $1
                  AND cd.status = 'verified'
                  AND s.status = 'active'
                "#,
                &[&domain],
            )
            .await?;

        Ok(row.map(|r| CachedSite {
            site_id:       r.get::<_, i32>("id"),
            domain:        r.get::<_, String>("domain"),
            visibility:    SiteVisibility::from(r.get::<_, &str>("visibility")),
            password_hash: r.get::<_, Option<String>>("password_hash"),
            site_type:     r.get::<_, String>("site_type"),
            spa_routing:   r.get::<_, i32>("spa_routing") != 0,
            cached_at:     std::time::Instant::now(),
        }))
    }

    /// Resolve a (site_id, file_path) to the file's storage metadata.
    pub async fn lookup_file(&self, site_id: i32, file_path: &str) -> Result<Option<CachedFile>> {
        let conn = self.pool.get().await?;

        // Join through active deployment so we only serve committed files
        let row = conn
            .query_opt(
                r#"
                SELECT f.object_path, f.content_type, f.size_bytes
                FROM site_files f
                JOIN site_deployments d ON d.id = f.deployment_id
                WHERE f.site_id    = $1
                  AND f.file_path  = $2
                  AND d.status     = 'active'
                "#,
                &[&site_id, &file_path],
            )
            .await?;

        Ok(row.map(|r| CachedFile {
            object_path:  r.get::<_, String>("object_path"),
            content_type: r.get::<_, String>("content_type"),
            size_bytes:   r.get::<_, i64>("size_bytes"),
            cached_at:    std::time::Instant::now(),
        }))
    }

    /// List active federation peers for geo routing.
    /// Returns (domain, region, status) tuples.
    pub async fn list_active_peers(&self) -> Result<Vec<(String, String, String)>> {
        let conn = self.pool.get().await?;
        let rows = conn
            .query(
                "SELECT domain, region, status FROM nodes WHERE status = 'active' AND is_local_node = 0 LIMIT 50",
                &[],
            )
            .await?;

        Ok(rows.into_iter().map(|r| (
            r.get::<_, String>("domain"),
            r.get::<_, String>("region"),
            r.get::<_, String>("status"),
        )).collect())
    }

    /// Record an analytics hit asynchronously.
    /// Called in a spawned task — never blocks request handling.
    pub async fn record_hit(
        &self,
        site_id: i32,
        path: &str,
        referrer: Option<&str>,
        ip_hash: Option<&str>,
        bytes_served: i64,
    ) -> Result<()> {
        let conn = self.pool.get().await?;
        conn.execute(
            r#"
            INSERT INTO analytics_buffer (site_id, path, referrer, ip_hash, bytes_served)
            VALUES ($1, $2, $3, $4, $5)
            "#,
            &[&site_id, &path, &referrer, &ip_hash, &bytes_served],
        )
        .await?;
        Ok(())
    }
}
