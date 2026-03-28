/**
 * Malware / content scanning hook.
 *
 * NexusHosting does not bundle a scanner — that would require ClamAV or a cloud
 * service as a sidecar, adding significant operational complexity for self-hosted
 * nodes. Instead, this module provides a configurable webhook that the node
 * operator can point at any scanner they choose.
 *
 * ## Configuration
 *
 * Set CONTENT_SCAN_WEBHOOK_URL to enable scanning. The webhook receives a POST
 * request for each deployment and should return { safe: true } or { safe: false, reason: "..." }.
 *
 * Example integrations:
 *   - ClamAV REST API (clamav-rest): https://github.com/benzino77/clamav-rest
 *   - VirusTotal API (requires API key)
 *   - Custom in-house scanner
 *   - Simple domain/content blocklist service
 *
 * If the webhook is unreachable or returns an error, the deploy is ALLOWED through
 * (fail-open). This prevents a scanner outage from blocking all deploys.
 * Set CONTENT_SCAN_FAIL_CLOSED=true to change this to fail-closed (stricter but
 * can break deploys if scanner is down).
 *
 * ## Webhook request format (POST)
 *
 * ```json
 * {
 *   "deploymentId": 42,
 *   "siteId": 7,
 *   "siteDomain": "mysite.example.com",
 *   "fileCount": 23,
 *   "totalSizeMb": 1.4,
 *   "files": [
 *     { "path": "index.html", "contentType": "text/html", "sizeBytes": 4096, "objectPath": "sites/7/..." }
 *   ]
 * }
 * ```
 *
 * ## Webhook response format
 *
 * ```json
 * { "safe": true }
 * { "safe": false, "reason": "Phishing page detected", "flaggedFiles": ["index.html"] }
 * ```
 */

import logger from "./logger.js";

const SCAN_WEBHOOK_URL = process.env.CONTENT_SCAN_WEBHOOK_URL ?? "";
const FAIL_CLOSED      = process.env.CONTENT_SCAN_FAIL_CLOSED === "true";
const SCAN_TIMEOUT_MS  = 30_000; // 30 seconds max for scanner response

export interface ScanTarget {
  deploymentId: number;
  siteId:       number;
  siteDomain:   string;
  fileCount:    number;
  totalSizeMb:  number;
  files:        Array<{
    path:        string;
    contentType: string;
    sizeBytes:   number;
    objectPath:  string;
  }>;
}

export interface ScanResult {
  safe:          boolean;
  reason?:       string;
  flaggedFiles?: string[];
  skipped:       boolean; // true if no scanner is configured
}

/**
 * Run a content scan via the configured external webhook.
 *
 * Returns { safe: true, skipped: true } if no scanner is configured.
 * Returns { safe: true, skipped: false } if scanner approved the content.
 * Returns { safe: false, reason: "..." } if scanner flagged the content.
 * Returns { safe: true, skipped: false } (fail-open) or throws (fail-closed)
 *   if the scanner is unreachable.
 */
export async function scanDeployment(target: ScanTarget): Promise<ScanResult> {
  if (!SCAN_WEBHOOK_URL) {
    return { safe: true, skipped: true };
  }

  try {
    const res = await fetch(SCAN_WEBHOOK_URL, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(target),
      signal:  AbortSignal.timeout(SCAN_TIMEOUT_MS),
    });

    if (!res.ok) {
      logger.warn(
        { status: res.status, deploymentId: target.deploymentId },
        "[scan] Scanner returned non-200 — treating as fail-open"
      );
      if (FAIL_CLOSED) {
        return { safe: false, skipped: false, reason: `Scanner returned HTTP ${res.status}` };
      }
      return { safe: true, skipped: false };
    }

    const data = await res.json() as { safe?: boolean; reason?: string; flaggedFiles?: string[] };

    if (data.safe === false) {
      logger.warn(
        { deploymentId: target.deploymentId, siteDomain: target.siteDomain, reason: data.reason },
        "[scan] Content scanner flagged deployment"
      );
      return { safe: false, skipped: false, reason: data.reason, flaggedFiles: data.flaggedFiles };
    }

    return { safe: true, skipped: false };

  } catch (err: any) {
    logger.warn(
      { err: err.message, deploymentId: target.deploymentId },
      "[scan] Scanner unreachable — " + (FAIL_CLOSED ? "blocking deploy" : "allowing through (fail-open)")
    );

    if (FAIL_CLOSED) {
      return { safe: false, skipped: false, reason: "Content scanner unreachable" };
    }
    return { safe: true, skipped: false };
  }
}

/** Whether content scanning is configured on this node. */
export function isScanningEnabled(): boolean {
  return SCAN_WEBHOOK_URL.length > 0;
}
