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

use anyhow::Result;
use deadpool_postgres::{Config as PgConfig, Pool, Runtime};
use tokio_postgres::NoTls;

use crate::cache::{CachedFile, CachedSite, SiteVisibility};

pub struct Db {
    pool: Pool,
}

impl Db {
    pub async fn new(database_url: &str) -> Result<Self> {
        let mut cfg = PgConfig::new();
        cfg.url = Some(database_url.to_string());

        let pool = cfg.create_pool(Some(Runtime::Tokio1), NoTls)?;

        // Verify connectivity at startup
        let _conn = pool.get().await?;

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
                SELECT id, domain, visibility, password_hash, site_type
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
                cached_at:     std::time::Instant::now(),
            }));
        }

        // Try custom domain
        let row = conn
            .query_opt(
                r#"
                SELECT s.id, s.domain, s.visibility, s.password_hash, s.site_type
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
