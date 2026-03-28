//! Object storage — AWS SDK v3 implementation.
//!
//! Works with AWS S3, Cloudflare R2, MinIO, Backblaze B2.
//! Mirrors TypeScript S3StorageProvider (same env vars, same behaviour).

use anyhow::{Context, Result};
use aws_config::BehaviorVersion;
use aws_credential_types::Credentials;
use aws_sdk_s3::Client;
use aws_sdk_s3::config::{Builder as S3ConfigBuilder, Region};
use bytes::Bytes;
use tracing::debug;

use crate::config::Config;

pub struct ObjectStorage {
    client: Client,
    bucket: String,
}

impl ObjectStorage {
    pub fn new(cfg: &Config) -> Result<Self> {
        let creds = Credentials::new(
            &cfg.storage_access_key,
            &cfg.storage_secret_key,
            None, None, "nexus-proxy",
        );

        let mut builder = S3ConfigBuilder::new()
            .credentials_provider(creds)
            .region(Region::new(cfg.storage_region.clone()))
            .behavior_version(BehaviorVersion::latest());

        if !cfg.storage_endpoint.is_empty() {
            tracing::info!(endpoint = %cfg.storage_endpoint, "Custom S3 endpoint");
            builder = builder
                .endpoint_url(&cfg.storage_endpoint)
                .force_path_style(true);
        }

        Ok(Self { client: Client::from_conf(builder.build()), bucket: cfg.storage_bucket.clone() })
    }

    pub async fn stream_object(&self, object_path: &str) -> Result<Bytes> {
        let key = object_path.trim_start_matches('/');
        debug!(bucket = %self.bucket, key, "S3 GetObject");
        let out = self.client.get_object().bucket(&self.bucket).key(key)
            .send().await
            .with_context(|| format!("S3 GetObject s3://{}/{}", self.bucket, key))?;
        Ok(out.body.collect().await.context("read S3 body")?.into_bytes())
    }

    pub async fn stream_object_body(
        &self, object_path: &str,
    ) -> Result<(Option<i64>, aws_sdk_s3::primitives::ByteStream)> {
        let key = object_path.trim_start_matches('/');
        let out = self.client.get_object().bucket(&self.bucket).key(key)
            .send().await
            .with_context(|| format!("S3 GetObject s3://{}/{}", self.bucket, key))?;
        Ok((out.content_length(), out.body))
    }

    pub async fn health_check(&self) -> Result<()> {
        self.client.head_bucket().bucket(&self.bucket).send().await
            .with_context(|| format!(
                "Cannot access bucket '{}'. Check OBJECT_STORAGE_ENDPOINT/ACCESS_KEY/SECRET_KEY/BUCKET.",
                self.bucket
            ))?;
        tracing::info!(bucket = %self.bucket, "Object storage OK");
        Ok(())
    }

    pub async fn presigned_url(&self, object_path: &str, expires_secs: u64) -> Result<String> {
        use aws_sdk_s3::presigning::PresigningConfig;
        use std::time::Duration;
        let key = object_path.trim_start_matches('/');
        let cfg = PresigningConfig::expires_in(Duration::from_secs(expires_secs))
            .context("presigning config")?;
        Ok(self.client.get_object().bucket(&self.bucket).key(key)
            .presigned(cfg).await
            .with_context(|| format!("presign s3://{}/{}", self.bucket, key))?
            .uri().to_string())
    }
}
