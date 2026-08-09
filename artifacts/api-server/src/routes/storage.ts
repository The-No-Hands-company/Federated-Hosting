import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import { storage, ObjectNotFoundError } from "../lib/storageProvider";
import { ObjectPermission } from "../lib/objectAcl";
import logger from "../lib/logger";

const router: IRouter = Router();

/**
 * End a failed object stream truthfully.
 *
 * streamToResponse sets Content-Type and Content-Length before the first byte
 * moves, so by the time it can fail the status line may already be on the wire.
 * Sending a 404 then throws ERR_HTTP_HEADERS_SENT, and ending cleanly is worse:
 * it claims a success that did not happen. Destroying the socket is the only
 * signal left that a client can tell apart from a complete response.
 *
 * Swallowing this is exactly what hid a total download outage — every request
 * logged 200 with a Content-Length and an empty body, and the only symptom
 * anywhere was an unattributable 520 from the edge.
 */
function failObjectStream(res: Response, objectPath: string, error: unknown): void {
  const notFound = error instanceof ObjectNotFoundError;
  if (!notFound) {
    logger.error({ objectPath, err: error }, "Failed to stream object from storage");
  }

  if (res.headersSent) {
    res.destroy(error instanceof Error ? error : new Error(String(error)));
    return;
  }

  if (notFound) {
    res.status(404).json({ error: "Object not found" });
    return;
  }
  res.status(500).json({ error: "Failed to serve object" });
}

/**
 * POST /storage/uploads/request-url
 *
 * Request a presigned URL for file upload.
 * The client sends JSON metadata (name, size, contentType) — NOT the file.
 * Then uploads the file directly to the returned presigned URL.
 */
router.post("/storage/uploads/request-url", async (req: Request, res: Response) => {
  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing or invalid required fields" });
    return;
  }

  try {
    const { name, size, contentType } = parsed.data;

    const { uploadUrl: uploadURL, objectPath } = await storage.getUploadUrl({ contentType: "application/octet-stream", ttlSec: 900 });

    res.json(
      RequestUploadUrlResponse.parse({
        uploadURL,
        objectPath,
        metadata: { name, size, contentType },
      }),
    );
  } catch (error) {
    console.error("Error generating upload URL:", error);
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

/**
 * GET /storage/public-objects/*
 *
 * Serve public assets from PUBLIC_OBJECT_SEARCH_PATHS.
 * These are unconditionally public — no authentication or ACL checks.
 * IMPORTANT: Always provide this endpoint when object storage is set up.
 */
router.get("/storage/public-objects/*filePath", async (req: Request, res: Response) => {
  try {
    const raw = req.params.filePath;
    const filePath = Array.isArray(raw) ? raw.join("/") : raw;
    // Map public filePath to an object path
    const objectPath = `/objects/${filePath}`;
    try {
      await storage.streamToResponse(objectPath, res);
    } catch (error) {
      failObjectStream(res, objectPath, error);
    }
    return;
  } catch (error) {
    logger.error({ err: error }, "Error serving public object");
    if (res.headersSent) {
      res.destroy(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    res.status(500).json({ error: "Failed to serve public object" });
  }
});

/**
 * GET /storage/objects/*
 *
 * Serve object entities from PRIVATE_OBJECT_DIR.
 * These are served from a separate path from /public-objects and can optionally
 * be protected with authentication or ACL checks based on the use case.
 */
router.get("/storage/objects/*path", async (req: Request, res: Response) => {
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    const objectPath = `/objects/${wildcardPath}`;
    try {
      await storage.streamToResponse(objectPath, res);
    } catch (error) {
      failObjectStream(res, objectPath, error);
    }
  } catch (error) {
    logger.error({ err: error }, "Error serving object");
    if (res.headersSent) {
      res.destroy(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Object not found" });
      return;
    }
    res.status(500).json({ error: "Failed to serve object" });
  }
});

export default router;
