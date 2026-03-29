/**
 * Storage initialisation — ensures the configured bucket exists.
 *
 * Called once at startup. Creates the bucket if it doesn't exist yet,
 * which means `docker compose up` just works without manual MinIO setup.
 *
 * Safe to call on every start — no-op if bucket already exists.
 * Fails gracefully if the storage provider doesn't support bucket creation
 * (e.g. AWS S3 where buckets are created via IAM/console).
 */

import logger from "./logger.js";

const ENDPOINT   = process.env.OBJECT_STORAGE_ENDPOINT ?? "";
const ACCESS_KEY = process.env.OBJECT_STORAGE_ACCESS_KEY ?? "";
const SECRET_KEY = process.env.OBJECT_STORAGE_SECRET_KEY ?? "";
const BUCKET     = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID
                ?? process.env.OBJECT_STORAGE_BUCKET
                ?? "nexus-sites";
const REGION     = process.env.OBJECT_STORAGE_REGION ?? "us-east-1";

export async function ensureBucketExists(): Promise<void> {
  if (!ENDPOINT || !ACCESS_KEY || !SECRET_KEY) {
    logger.debug("[storage-init] Skipping bucket check — storage not fully configured");
    return;
  }

  try {
    const { S3Client, HeadBucketCommand, CreateBucketCommand } = await import("@aws-sdk/client-s3");

    const client = new S3Client({
      endpoint:         ENDPOINT,
      region:           REGION,
      credentials:      { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
      forcePathStyle:   true, // required for MinIO
    });

    // Check if bucket exists
    try {
      await client.send(new HeadBucketCommand({ Bucket: BUCKET }));
      logger.info({ bucket: BUCKET }, "[storage-init] Bucket exists ✓");
      return;
    } catch (err: any) {
      // 404 / NoSuchBucket = doesn't exist, create it
      // 403 / AccessDenied = exists but no access (don't try to create)
      if (err?.name === "AccessDenied" || err?.$metadata?.httpStatusCode === 403) {
        logger.warn({ bucket: BUCKET }, "[storage-init] Bucket exists but access denied — check credentials");
        return;
      }
    }

    // Create the bucket
    await client.send(new CreateBucketCommand({ Bucket: BUCKET }));
    logger.info({ bucket: BUCKET }, "[storage-init] Bucket created ✓");

    // Set bucket to private (block public access) — objects served via presigned URLs
    try {
      const { PutBucketPolicyCommand } = await import("@aws-sdk/client-s3");
      // Leave as default private — no public policy needed
      logger.debug({ bucket: BUCKET }, "[storage-init] Bucket policy: private (default)");
    } catch { /* optional — skip if S3 API subset doesn't support it */ }

  } catch (err: any) {
    // Non-fatal — if bucket creation fails, deploys will fail with a clear error
    // rather than crashing the server on startup
    logger.warn(
      { bucket: BUCKET, endpoint: ENDPOINT, err: err.message },
      "[storage-init] Could not verify/create bucket — storage may not be ready yet. " +
      "Deploys will fail until the bucket exists."
    );
  }
}
