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
import { pipeline } from "stream/promises";
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
  /** Signs URLs handed to external clients; see the constructor. */
  private readonly presignClient: import("@aws-sdk/client-s3").S3Client;
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
    const credentials = process.env.OBJECT_STORAGE_ACCESS_KEY ? {
      accessKeyId: process.env.OBJECT_STORAGE_ACCESS_KEY,
      secretAccessKey: process.env.OBJECT_STORAGE_SECRET_KEY ?? "",
    } : undefined;
    const region = process.env.OBJECT_STORAGE_REGION ?? "auto";

    this.client = new S3Client({
      region,
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
      ...(credentials ? { credentials } : {}),
    });

    /*
     * Presigned URLs are handed to a browser or a CLI, so they must name an
     * address that client can reach. OBJECT_STORAGE_ENDPOINT is the address this
     * server uses, which in the Docker deployment is http://minio:9000 — a
     * compose-internal hostname. Signing with it produced upload URLs nothing
     * outside the compose network could use, so deploying a site was impossible
     * for any real client.
     *
     * The signature covers the Host header, so this cannot be rewritten after
     * signing: the URL has to be signed against the public endpoint from the
     * start. Hence a second client that differs only in its endpoint.
     *
     * Left unset, presigning falls back to the single client, which is correct
     * when OBJECT_STORAGE_ENDPOINT is already public — a node using S3 or R2
     * directly needs no second endpoint.
     */
    const publicEndpoint = process.env.OBJECT_STORAGE_PUBLIC_ENDPOINT;
    this.presignClient = publicEndpoint
      ? new S3Client({
          region,
          endpoint: publicEndpoint,
          forcePathStyle: true,
          ...(credentials ? { credentials } : {}),
        })
      : this.client;
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

    const uploadUrl = await getSignedUrl(this.presignClient, command, { expiresIn: opts.ttlSec });
    return { uploadUrl, objectPath };
  }

  async getDownloadUrl(objectPath: string, ttlSec = 3600): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: this.objectKey(objectPath),
    });

    return getSignedUrl(this.presignClient, command, { expiresIn: ttlSec });
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

    /*
     * Body is a union across runtimes and the arm you get is decided by the
     * SDK's HTTP handler, not by the type. Under Node it is the IncomingMessage
     * off the socket — already a Readable — and a web ReadableStream arrives
     * only under the fetch handler used in browsers and edge runtimes.
     * Readable.fromWeb() throws ERR_INVALID_ARG_TYPE on the former, so
     * converting unconditionally broke every download this server serves,
     * including every file of every deployed site. Both arms are handled
     * because both are reachable; neither is a hypothetical.
     */
    const body = response.Body as unknown;
    const nodeStream = body instanceof Readable
      ? body
      : Readable.fromWeb(body as ReadableStream);

    /*
     * pipeline rather than pipe: it propagates a mid-stream failure to the
     * caller and tears the response down instead of leaving it open. The
     * headers above are already sent by then, so a truncated transfer is the
     * only honest signal left — resolving here would answer 200 with a
     * Content-Length that the body does not satisfy.
     */
    await pipeline(nodeStream, res);
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
