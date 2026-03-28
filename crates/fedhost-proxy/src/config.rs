use anyhow::{Context, Result};
use clap::Parser;

/// fedhost-proxy configuration, loaded from environment variables.
/// All settings mirror or complement the TypeScript server's `.env`.
#[derive(Debug, Clone, Parser)]
#[command(name = "fedhost-proxy", about = "Federated Hosting static site proxy")]
pub struct Config {
    /// PostgreSQL connection string (same as TypeScript server)
    #[arg(env = "DATABASE_URL")]
    pub database_url: String,

    /// S3-compatible endpoint URL (blank = AWS default)
    #[arg(env = "OBJECT_STORAGE_ENDPOINT", default_value = "")]
    pub storage_endpoint: String,

    /// S3 access key
    #[arg(env = "OBJECT_STORAGE_ACCESS_KEY", default_value = "")]
    pub storage_access_key: String,

    /// S3 secret key
    #[arg(env = "OBJECT_STORAGE_SECRET_KEY", default_value = "")]
    pub storage_secret_key: String,

    /// S3 bucket name
    #[arg(env = "OBJECT_STORAGE_BUCKET", env = "DEFAULT_OBJECT_STORAGE_BUCKET_ID", default_value = "fedhost-sites")]
    pub storage_bucket: String,

    /// S3 region
    #[arg(env = "OBJECT_STORAGE_REGION", default_value = "auto")]
    pub storage_region: String,

    /// Redis URL for shared LRU cache (optional — falls back to in-process)
    #[arg(env = "REDIS_URL", default_value = "")]
    pub redis_url: String,

    /// HMAC secret for verifying unlock cookies (must match TypeScript COOKIE_SECRET)
    #[arg(env = "COOKIE_SECRET", default_value = "dev-only-insecure-cookie-secret")]
    pub cookie_secret: String,

    /// Address to listen on for site serving
    #[arg(env = "PROXY_LISTEN_ADDR", default_value = "0.0.0.0:8090")]
    pub listen_addr: String,

    /// Address to expose Prometheus metrics on
    #[arg(env = "METRICS_LISTEN_ADDR", default_value = "0.0.0.0:9091")]
    pub metrics_addr: String,

    /// TypeScript API server URL (used for internal health checks)
    #[arg(env = "PROXY_API_URL", default_value = "http://127.0.0.1:8080")]
    pub api_url: String,

    /// Low-resource mode (reduces cache sizes, concurrency)
    #[arg(env = "LOW_RESOURCE", default_value = "false")]
    pub low_resource: bool,

    /// Enable geographic routing redirects
    #[arg(env = "ENABLE_GEO_ROUTING", default_value = "false")]
    pub geo_routing_enabled: bool,

    /// This node's AWS-style region (used for geo routing origin)
    #[arg(env = "NODE_REGION", default_value = "us-east-1")]
    pub node_region: String,

    /// Domain LRU cache capacity
    #[arg(env = "DOMAIN_CACHE_MAX", default_value_t = 10_000)]
    pub domain_cache_max: usize,

    /// File path LRU cache capacity
    #[arg(env = "FILE_CACHE_MAX", default_value_t = 50_000)]
    pub file_cache_max: usize,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        // Load .env file if present (development)
        let _ = dotenvy::dotenv();

        let mut cfg = Self::try_parse().context("Failed to parse configuration")?;

        // Apply LOW_RESOURCE overrides
        if cfg.low_resource {
            if cfg.domain_cache_max == 10_000 { cfg.domain_cache_max = 500; }
            if cfg.file_cache_max  == 50_000 { cfg.file_cache_max   = 2_000; }
            tracing::warn!(
                domain_cache = cfg.domain_cache_max,
                file_cache   = cfg.file_cache_max,
                "LOW_RESOURCE mode active"
            );
        }

        Ok(cfg)
    }
}
