/**
 * ACME / Let's Encrypt TLS automation.
 *
 * Full implementation using the `acme-client` library.
 * Supports two challenge types — choose based on your infrastructure:
 *
 * HTTP-01 (default, ACME_CHALLENGE_TYPE=http):
 *   - Server must be reachable on port 80 from Let's Encrypt
 *   - Simpler setup — no DNS API credentials needed
 *   - Set ACME_CHALLENGE_TYPE=http or leave unset
 *
 * DNS-01 (ACME_CHALLENGE_TYPE=dns):
 *   - No port 80 required — works behind NAT, firewalls, private networks
 *   - Requires DNS provider API access (see ACME_DNS_PROVIDER)
 *   - Supports wildcard certificates
 *   - Operators must implement DNS record creation in the challengeCreateFn
 *   - Set ACME_CHALLENGE_TYPE=dns and ACME_DNS_PROVIDER=<provider>
 *
 * Environment variables:
 *   ACME_ENABLED=true           — activate this module
 *   ACME_EMAIL=you@example.com  — Let's Encrypt account email (required)
 *   ACME_CERT_DIR=/etc/certs    — where certs are written (default: /etc/certs)
 *   ACME_STAGING=true           — use Let's Encrypt staging CA (safer for testing)
 *   ACME_CHALLENGE_TYPE=http    — http (default) or dns
 *   ACME_DNS_PROVIDER=          — DNS provider identifier (cloudflare, route53, etc.)
 *
 * For DNS-01, the node operator must configure a DNS provider hook.
 * See docs/TLS.md for per-provider setup instructions.
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
  challengeType?: "http-01" | "dns-01";
  error?: string;
}

// DNS-01 challenge hook type — operators implement this for their DNS provider
export type DnsChallengeFn = (domain: string, txtValue: string) => Promise<void>;
export type DnsCleanupFn  = (domain: string, txtValue: string) => Promise<void>;

// Operator-registered DNS hooks (set before startAcmeRenewalScheduler)
let dnsCreateHook: DnsChallengeFn | null = null;
let dnsCleanupHook: DnsCleanupFn | null = null;

export function registerDnsHooks(create: DnsChallengeFn, cleanup: DnsCleanupFn): void {
  dnsCreateHook = create;
  dnsCleanupHook = cleanup;
  logger.info("[acme] DNS-01 challenge hooks registered");
}

/** Provision or renew a TLS certificate for the given domain */
export async function provisionCertificate(domain: string): Promise<ProvisionResult> {
  if (!process.env.ACME_ENABLED) {
    return { success: false, domain, error: "ACME_ENABLED is not set" };
  }
  if (!EMAIL) {
    return { success: false, domain, error: "ACME_EMAIL must be set" };
  }

  const challengeType = (process.env.ACME_CHALLENGE_TYPE ?? "http") === "dns" ? "dns-01" : "http-01";

  if (challengeType === "dns-01" && (!dnsCreateHook || !dnsCleanupHook)) {
    return {
      success: false,
      domain,
      error: "ACME_CHALLENGE_TYPE=dns requires DNS hooks. See docs/TLS.md for setup.",
    };
  }

  logger.info({ domain, challengeType, staging: STAGING }, "[acme] Starting certificate provisioning");

  try {
    const client = await getClient();

    const [domainKey, csr] = await acme.crypto.createCsr({
      commonName: domain,
      altNames: [domain],
    });

    let challengeToken = "";

    const cert = await client.auto({
      csr,
      email: EMAIL,
      termsOfServiceAgreed: true,
      challengePriority: [challengeType],

      challengeCreateFn: async (_authz, challenge, keyAuthorization) => {
        if (challenge.type === "http-01") {
          const parts = keyAuthorization.split(".");
          challengeToken = parts[0] ?? "";
          acmeChallenges.set(challengeToken, keyAuthorization);
          logger.debug({ domain, token: challengeToken }, "[acme] HTTP-01 challenge registered");
        } else if (challenge.type === "dns-01") {
          // DNS-01: create _acme-challenge.<domain> TXT record
          const txtValue = (await acme.crypto.digest("SHA-256", Buffer.from(keyAuthorization)))
            .toString("base64url");
          await dnsCreateHook!(domain, txtValue);
          logger.debug({ domain }, "[acme] DNS-01 TXT record created — waiting for propagation");
          // Wait for DNS propagation (30s min — operators can increase via env)
          const propagationWait = parseInt(process.env.ACME_DNS_PROPAGATION_WAIT ?? "30000", 10);
          await new Promise(res => setTimeout(res, propagationWait));
        }
      },

      challengeRemoveFn: async (_authz, challenge, keyAuthorization) => {
        if (challenge.type === "http-01") {
          acmeChallenges.delete(challengeToken);
        } else if (challenge.type === "dns-01") {
          const txtValue = (await acme.crypto.digest("SHA-256", Buffer.from(keyAuthorization)))
            .toString("base64url");
          await dnsCleanupHook!(domain, txtValue).catch(() => {});
          logger.debug({ domain }, "[acme] DNS-01 TXT record cleaned up");
        }
      },
    });

    // Write cert and key to disk
    const certDir = path.join(CERT_DIR, domain);
    fs.mkdirSync(certDir, { recursive: true });
    fs.writeFileSync(certPath(domain), cert, { mode: 0o644 });
    fs.writeFileSync(keyPath(domain), domainKey, { mode: 0o600 });

    const expiry = getCertExpiry(domain);
    logger.info({ domain, challengeType, expiresAt: expiry?.toISOString() }, "[acme] Certificate provisioned");

    await db.update(customDomainsTable)
      .set({ verifiedAt: new Date(), status: "verified", lastCheckedAt: new Date() })
      .where(eq(customDomainsTable.domain, domain));

    return {
      success: true,
      domain,
      certPath: certPath(domain),
      keyPath: keyPath(domain),
      expiresAt: expiry?.toISOString(),
      challengeType,
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
