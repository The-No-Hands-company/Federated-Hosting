//! Redis-based cache invalidation subscriber.
//!
//! When the TypeScript API server deploys a site or changes its settings,
//! it publishes:
//!   `PUBLISH nexushosting:cache:invalidate <siteId>`
//!
//! This subscriber listens on that channel and evicts the relevant entries
//! from both the domain cache and file cache immediately, so subsequent
//! requests hit the DB and get fresh data.
//!
//! If REDIS_URL is not set, this module is a no-op — caches rely solely
//! on TTL expiry (5 minutes).

use std::sync::Arc;
use futures_util::StreamExt;
use tracing::{info, warn, error};

use crate::cache::{DomainCache, FileCache};

const CHANNEL: &str = "nexushosting:cache:invalidate";
const RECONNECT_DELAY_MS: u64 = 2_000;

/// Spawn the Redis subscriber as a background Tokio task.
///
/// Returns immediately — the task runs for the process lifetime.
/// Any Redis error causes a reconnect after `RECONNECT_DELAY_MS`.
pub fn spawn_invalidation_subscriber(
    redis_url: String,
    domain_cache: Arc<DomainCache>,
    file_cache:   Arc<FileCache>,
) {
    if redis_url.is_empty() {
        info!("REDIS_URL not set — cache invalidation disabled (TTL-only expiry)");
        return;
    }

    tokio::spawn(async move {
        loop {
            match run_subscriber(&redis_url, &domain_cache, &file_cache).await {
                Ok(()) => {
                    warn!("Redis subscriber exited cleanly — reconnecting");
                }
                Err(e) => {
                    error!(error = %e, "Redis subscriber error — reconnecting in {}ms", RECONNECT_DELAY_MS);
                }
            }
            tokio::time::sleep(std::time::Duration::from_millis(RECONNECT_DELAY_MS)).await;
        }
    });
}

async fn run_subscriber(
    redis_url:    &str,
    domain_cache: &Arc<DomainCache>,
    file_cache:   &Arc<FileCache>,
) -> anyhow::Result<()> {
    let client = redis::Client::open(redis_url)?;
    let mut pubsub = client.get_async_pubsub().await?;
    pubsub.subscribe(CHANNEL).await?;

    info!(channel = CHANNEL, "Redis cache invalidation subscriber connected");

    let mut stream = pubsub.into_on_message();

    while let Some(msg) = {
        stream.next().await
    } {
        let payload: String = match msg.get_payload() {
            Ok(p) => p,
            Err(e) => {
                warn!(error = %e, "Invalid Redis message payload");
                continue;
            }
        };

        let site_id: i32 = match payload.trim().parse() {
            Ok(id) => id,
            Err(_) => {
                warn!(payload, "Non-integer siteId in invalidation message");
                continue;
            }
        };

        // Evict from both caches
        domain_cache.invalidate_site(site_id).await;
        file_cache.invalidate_site(site_id).await;

        tracing::debug!(site_id, "Cache invalidated via Redis");
    }

    Ok(())
}
