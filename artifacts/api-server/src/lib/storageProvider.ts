/**
 * Storage provider abstraction layer.
 *
 * All storage operations go through this interface. Two implementations:
 *   - S3StorageProvider      — AWS S3, Cloudflare R2, MinIO, Backblaze B2, any S3-compatible
 *
 * Which provider is used is determined at startup based on environment variables:
 *   Requires OBJECT_STORAGE_ENDPOINT (or AWS_ACCESS_KEY_ID) to be set.
 *   In development without credentials, logs a warning and continues.
 *
 * The active provider is exported as `storage` and used everywhere.
 */

import { Readable } from "stream";
import { randomUUID } from "crypto";
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import logger from "./logger";

// ── Provider interface ─────────────────────────────────────────────────────────

export interface ObjectFile {
  /** Provider-internal reference — treat as opaque */
  _ref: unknown;
  /** Normalized path used as the DB key: /objects/<id> */
  objectPath: string;
  contentType: string;
  size: number;
}

export interface StorageProvider {
  /** Generate a presigned PUT URL for direct browser/CLI upload */
  getUploadUrl(opts: { contentType: string; ttlSec: number }): Promise<{ uploadUrl: string; objectPath: string }>;
  /** Generate a presigned GET URL for direct download (used in federation manifest) */
  getDownloadUrl(objectPath: string, ttlSec?: number): Promise<string>;
  /** Stream a file to an Express response */
  streamToResponse(objectPath: string, res: import("express").Response): Promise<void>;
  /** Check file existence and get metadata */
  stat(objectPath: string): Promise<{ contentType: string; size: number } | null>;
  /** Delete a file — called during cleanup jobs */
  delete(objectPath: string): Promise<void>;
}

// ── Custom errors ──────────────────────────────────────────────────────────────

export class ObjectNotFoundError extends Error {
  constructor(path?: string) {
    super(path ? `Object not found: ${path}` : "Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

// ── S3-compatible provider ─────────────────────────────────────────────────────

export class S3StorageProvider implements StorageProvider {
  private readonly client: import("@aws-sdk/client-s3").S3Client;
  private readonly bucket: string;
  private readonly prefix: string;

  constructor() {
    this.bucket = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID ??
      process.env.OBJECT_STORAGE_BUCKET ?? "";
    this.prefix = process.env.PRIVATE_OBJECT_DIR ?? "private";

    if (!this.bucket) {
      throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID or OBJECT_STORAGE_BUCKET must be set");
    }

    const endpoint = process.env.OBJECT_STORAGE_ENDPOINT;
    this.client = new S3Client({
      region: process.env.OBJECT_STORAGE_REGION ?? "auto",
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
      credentials: process.env.OBJECT_STORAGE_ACCESS_KEY ? {
        accessKeyId: process.env.OBJECT_STORAGE_ACCESS_KEY,
        secretAccessKey: process.env.OBJECT_STORAGE_SECRET_KEY ?? "",
      } : undefined,
    });
  }

  private objectKey(objectPath: string): string {
    // objectPath is /objects/<uuid> — strip leading slash for S3 key
    return objectPath.startsWith("/") ? objectPath.slice(1) : objectPath;
  }

  private newObjectPath(): string {
    return `/objects/${this.prefix}/uploads/${randomUUID()}`;
  }

  async getUploadUrl(opts: { contentType: string; ttlSec: number }): Promise<{ uploadUrl: string; objectPath: string }> {
    const objectPath = this.newObjectPath();
    const key = this.objectKey(objectPath);

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: opts.contentType,
    });

    const uploadUrl = await getSignedUrl(this.client, command, { expiresIn: opts.ttlSec });
    return { uploadUrl, objectPath };
  }

  async getDownloadUrl(objectPath: string, ttlSec = 3600): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: this.objectKey(objectPath),
    });

    return getSignedUrl(this.client, command, { expiresIn: ttlSec });
  }

  async streamToResponse(objectPath: string, res: import("express").Response): Promise<void> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: this.objectKey(objectPath),
    });

    const response = await this.client.send(command);

    if (!response.Body) throw new ObjectNotFoundError(objectPath);

    if (response.ContentType) res.setHeader("Content-Type", response.ContentType);
    if (response.ContentLength) res.setHeader("Content-Length", String(response.ContentLength));

    // S3 Body is a ReadableStream in Node.js — pipe it
    const nodeStream = Readable.fromWeb(response.Body as ReadableStream);
    await new Promise<void>((resolve, reject) => {
      nodeStream.pipe(res);
      nodeStream.on("error", reject);
      res.on("finish", resolve);
    });
  }

  async stat(objectPath: string): Promise<{ contentType: string; size: number } | null> {
    try {
      const response = await this.client.send(new HeadObjectCommand({
        Bucket: this.bucket,
        Key: this.objectKey(objectPath),
      }));
      return {
        contentType: response.ContentType ?? "application/octet-stream",
        size: response.ContentLength ?? 0,
      };
    } catch (err: any) {
      if (err.name === "NotFound" || err.$metadata?.httpStatusCode === 404) return null;
      throw err;
    }
  }

  async delete(objectPath: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: this.objectKey(objectPath),
    }));
  }
}

// ── Provider selection ─────────────────────────────────────────────────────────

function createProvider(): StorageProvider {
  const hasS3Config = Boolean(
    process.env.OBJECT_STORAGE_ENDPOINT ||
    process.env.OBJECT_STORAGE_ACCESS_KEY ||
    process.env.AWS_ACCESS_KEY_ID
  );

  if (!hasS3Config) {
    const msg =
      "No object storage configured. Set OBJECT_STORAGE_ENDPOINT (MinIO/S3-compatible) " +
      "or AWS_ACCESS_KEY_ID + OBJECT_STORAGE_BUCKET to configure storage.";
    if (process.env.NODE_ENV === "production") {
      throw new Error(msg);
    }
    logger.warn("[storage] " + msg + " Using S3 provider with empty credentials (dev mode).");
  }

  logger.info("[storage] Using S3-compatible storage provider");
  return new S3StorageProvider();
}

export const storage: StorageProvider = createProvider();
