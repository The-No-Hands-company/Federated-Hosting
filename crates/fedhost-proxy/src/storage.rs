//! Object storage access using the AWS SDK v3.
//!
//! Supports any S3-compatible provider: AWS S3, Cloudflare R2, MinIO, Backblaze B2.
//! Configuration mirrors the TypeScript `S3StorageProvider`.

use anyhow::{Context, Result};
use aws_sdk_s3::Client;
use bytes::Bytes;

use crate::config::Config;

pub struct ObjectStorage {
    client: Client,
    bucket: String,
}

impl ObjectStorage {
    pub fn new(cfg: &Config) -> Result<Self> {
        todo!(
            "Construct aws_sdk_s3::Client from cfg.storage_endpoint, \
             cfg.storage_access_key, cfg.storage_secret_key, cfg.storage_region. \
             See https://docs.rs/aws-sdk-s3 for SdkConfig + Credentials setup."
        )
    }

    /// Stream an object from S3 into memory and return the bytes.
    /// For large files, replace with streaming directly into the response body
    /// using `GetObjectOutput::body` as a `StreamBody`.
    pub async fn stream_object(&self, object_path: &str) -> Result<Bytes> {
        let key = object_path.trim_start_matches('/');

        let output = self.client
            .get_object()
            .bucket(&self.bucket)
            .key(key)
            .send()
            .await
            .context("S3 GetObject failed")?;

        let body = output
            .body
            .collect()
            .await
            .context("Failed to read S3 response body")?;

        Ok(body.into_bytes())
    }
}
