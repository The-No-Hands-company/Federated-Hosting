/**
 * ACME / Let's Encrypt TLS automation.
 *
 * Full implementation using the `acme-client` library:
 *   1. Creates/reuses an ACME account (stored in DB node settings)
 *   2. Places an HTTP-01 challenge order
 *   3. Serves challenge tokens at /.well-known/acme-challenge/<token>
 *   4. Finalises the order, downloads the certificate
 *   5. Writes cert + key to ACME_CERT_DIR/<domain>/
 *   6. Schedules renewal 30 days before expiry
 *
 * Environment variables:
 *   ACME_ENABLED=true          — activate this module
 *   ACME_EMAIL=you@example.com — Let's Encrypt account email (required)
 *   ACME_CERT_DIR=/etc/certs   — where certs are written (default: /etc/certs)
 *   ACME_STAGING=true          — use Let's Encrypt staging CA (default: false)
 *
 * Challenge tokens are served by the ACME challenge route in routes/tls.ts.
 * The server MUST be reachable on port 80 from Let's Encrypt servers.
 */

import acme from "acme-client";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import logger from "./logger";
import { db, customDomainsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// Shared challenge token store — read by GET /.well-known/acme-challenge/:token
export const acmeChallenges = new Map<string, string>();

const CERT_DIR = process.env.ACME_CERT_DIR ?? "/etc/certs";
const STAGING  = process.env.ACME_STAGING === "true";
const EMAIL    = process.env.ACME_EMAIL ?? "";

function certPath(domain: string) { return path.join(CERT_DIR, domain, "fullchain.pem"); }
function keyPath(domain: string)  { return path.join(CERT_DIR, domain, "privkey.pem"); }

/** Read a cert file and return its expiry date, or null if missing/unreadable */
function getCertExpiry(domain: string): Date | null {
  try {
    const pem = fs.readFileSync(certPath(domain), "utf8");
    // Extract expiry using Node's built-in X.509 support (available Node 16+)
    const cert = new crypto.X509Certificate(pem);
    return new Date(cert.validTo);
  } catch {
    return null;
  }
}

/** Returns true if cert exists and expires more than 30 days from now */
export function certIsValid(domain: string): boolean {
  const expiry = getCertExpiry(domain);
  if (!expiry) return false;
  const daysLeft = (expiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  return daysLeft > 30;
}

let acmeClient: acme.Client | null = null;

async function getClient(): Promise<acme.Client> {
  if (acmeClient) return acmeClient;

  // Generate or load account key
  const accountKeyPath = path.join(CERT_DIR, "account.key");
  let accountKey: Buffer;

  try {
    accountKey = fs.readFileSync(accountKeyPath);
    logger.debug("[acme] Loaded existing account key");
  } catch {
    logger.info("[acme] Generating new ACME account key");
    accountKey = await acme.crypto.createPrivateKey();
    fs.mkdirSync(CERT_DIR, { recursive: true });
    fs.writeFileSync(accountKeyPath, accountKey, { mode: 0o600 });
  }

  acmeClient = new acme.Client({
    directoryUrl: STAGING
      ? acme.directory.letsencrypt.staging
      : acme.directory.letsencrypt.production,
    accountKey,
  });

  return acmeClient;
}

export interface ProvisionResult {
  success: boolean;
  domain: string;
  certPath?: string;
  keyPath?: string;
  expiresAt?: string;
  error?: string;
}

/** Provision or renew a TLS certificate for the given domain */
export async function provisionCertificate(domain: string): Promise<ProvisionResult> {
  if (!process.env.ACME_ENABLED) {
    return { success: false, domain, error: "ACME_ENABLED is not set" };
  }
  if (!EMAIL) {
    return { success: false, domain, error: "ACME_EMAIL must be set" };
  }

  logger.info({ domain, staging: STAGING }, "[acme] Starting certificate provisioning");

  try {
    const client = await getClient();

    // Generate a new key for this domain
    const [domainKey, csr] = await acme.crypto.createCsr({
      commonName: domain,
      altNames: [domain],
    });

    let challengeToken = "";
    let challengeKeyAuth = "";

    const cert = await client.auto({
      csr,
      email: EMAIL,
      termsOfServiceAgreed: true,

      challengePriority: ["http-01"], // HTTP-01 only — no DNS required

      challengeCreateFn: async (_authz, _challenge, keyAuthorization) => {
        const parts = keyAuthorization.split(".");
        challengeToken = parts[0] ?? "";
        challengeKeyAuth = keyAuthorization;
        // Register challenge for the challenge-serving route
        acmeChallenges.set(challengeToken, keyAuthorization);
        logger.debug({ domain, token: challengeToken }, "[acme] HTTP-01 challenge registered");
      },

      challengeRemoveFn: async (_authz, _challenge, _keyAuthorization) => {
        acmeChallenges.delete(challengeToken);
        logger.debug({ domain }, "[acme] HTTP-01 challenge removed");
      },
    });

    // Write cert and key to disk
    const certDir = path.join(CERT_DIR, domain);
    fs.mkdirSync(certDir, { recursive: true });
    fs.writeFileSync(certPath(domain), cert, { mode: 0o644 });
    fs.writeFileSync(keyPath(domain), domainKey, { mode: 0o600 });

    const expiry = getCertExpiry(domain);
    logger.info({ domain, expiresAt: expiry?.toISOString() }, "[acme] Certificate provisioned");

    // Update domain record in DB
    await db.update(customDomainsTable)
      .set({ verifiedAt: new Date(), status: "verified", lastCheckedAt: new Date() })
      .where(eq(customDomainsTable.domain, domain));

    return {
      success: true,
      domain,
      certPath: certPath(domain),
      keyPath: keyPath(domain),
      expiresAt: expiry?.toISOString(),
    };

  } catch (err: any) {
    logger.error({ domain, err: err.message }, "[acme] Certificate provisioning failed");
    return { success: false, domain, error: err.message };
  }
}

// ── Auto-renewal scheduler ─────────────────────────────────────────────────────

let renewalTimer: NodeJS.Timeout | null = null;

async function checkRenewals(): Promise<void> {
  if (!process.env.ACME_ENABLED) return;

  const verifiedDomains = await db
    .select({ domain: customDomainsTable.domain })
    .from(customDomainsTable)
    .where(eq(customDomainsTable.status, "verified"));

  for (const { domain } of verifiedDomains) {
    if (!certIsValid(domain)) {
      logger.info({ domain }, "[acme] Certificate missing or expiring — renewing");
      const result = await provisionCertificate(domain);
      if (!result.success) {
        logger.error({ domain, error: result.error }, "[acme] Renewal failed");
      }
    }
  }
}

export function startAcmeRenewalScheduler(): void {
  if (!process.env.ACME_ENABLED) return;
  // Check renewals on startup and then every 12 hours
  checkRenewals().catch(err => logger.warn({ err }, "[acme] Initial renewal check failed"));
  renewalTimer = setInterval(() => {
    checkRenewals().catch(err => logger.warn({ err }, "[acme] Scheduled renewal check failed"));
  }, 12 * 60 * 60 * 1000);
  logger.info("[acme] Certificate renewal scheduler started (12h interval)");
}

export function stopAcmeRenewalScheduler(): void {
  if (renewalTimer) { clearInterval(renewalTimer); renewalTimer = null; }
}
