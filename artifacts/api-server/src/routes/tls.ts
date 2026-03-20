/**
 * TLS / ACME routes.
 *
 * GET  /.well-known/acme-challenge/:token  — serve HTTP-01 challenges (must be at root)
 * GET  /api/domains/:id/tls-status         — cert status, expiry, validity
 * POST /api/domains/:id/provision-tls      — trigger certificate provisioning
 *
 * Full ACME provisioning is handled by lib/acme.ts using the `acme-client` library.
 * Set ACME_ENABLED=true, ACME_EMAIL=you@example.com to activate.
 * Without ACME_ENABLED, returns instructions to configure Caddy/certbot manually.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, customDomainsTable, sitesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { asyncHandler, AppError } from "../lib/errors";
import { acmeChallenges, provisionCertificate, certIsValid } from "../lib/acme";
import logger from "../lib/logger";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const router: IRouter = Router();
const CERT_DIR = process.env.ACME_CERT_DIR ?? "/etc/certs";

// ── HTTP-01 challenge serving (root-level, no /api prefix) ────────────────────

router.get("/.well-known/acme-challenge/:token", (req: Request, res: Response) => {
  const token = req.params.token as string;
  const keyAuthorization = acmeChallenges.get(token);
  if (keyAuthorization) {
    logger.debug({ token }, "[acme] Serving HTTP-01 challenge");
    res.setHeader("Content-Type", "text/plain");
    res.send(keyAuthorization);
    return;
  }
  res.status(404).send("Not found");
});

// ── TLS status ────────────────────────────────────────────────────────────────

router.get("/domains/:id/tls-status", asyncHandler(async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();

  const id = parseInt(req.params.id as string, 10);
  if (Number.isNaN(id)) throw AppError.badRequest("Invalid domain ID");

  const [domain] = await db.select().from(customDomainsTable).where(eq(customDomainsTable.id, id));
  if (!domain) throw AppError.notFound("Domain not found");

  const [site] = await db.select({ ownerId: sitesTable.ownerId }).from(sitesTable).where(eq(sitesTable.id, domain.siteId));
  if (!site || site.ownerId !== req.user.id) throw AppError.forbidden();

  const certFile = path.join(CERT_DIR, domain.domain, "fullchain.pem");
  let certExists = false;
  let certExpiry: string | null = null;
  let daysUntilExpiry: number | null = null;
  let isValid = false;

  try {
    if (fs.existsSync(certFile)) {
      const pem = fs.readFileSync(certFile, "utf8");
      const cert = new crypto.X509Certificate(pem);
      certExpiry = cert.validTo;
      certExists = true;
      daysUntilExpiry = Math.floor((new Date(cert.validTo).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      isValid = daysUntilExpiry > 0;
    }
  } catch { /* cert unreadable */ }

  res.json({
    domainId: id,
    domain: domain.domain,
    domainVerified: domain.status === "verified",
    acmeEnabled: process.env.ACME_ENABLED === "true",
    certExists,
    certExpiry,
    daysUntilExpiry,
    isValid,
    willAutoRenew: process.env.ACME_ENABLED === "true" && certExists,
  });
}));

// ── Provision TLS ─────────────────────────────────────────────────────────────

router.post("/domains/:id/provision-tls", asyncHandler(async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();

  const id = parseInt(req.params.id as string, 10);
  if (Number.isNaN(id)) throw AppError.badRequest("Invalid domain ID");

  const [domain] = await db.select().from(customDomainsTable).where(eq(customDomainsTable.id, id));
  if (!domain) throw AppError.notFound("Domain not found");

  const [site] = await db.select({ ownerId: sitesTable.ownerId }).from(sitesTable).where(eq(sitesTable.id, domain.siteId));
  if (!site || site.ownerId !== req.user.id) throw AppError.forbidden();

  if (domain.status !== "verified") {
    throw AppError.badRequest("Domain DNS must be verified before TLS can be provisioned", "DOMAIN_NOT_VERIFIED");
  }

  // If ACME is not enabled, return clear manual instructions
  if (process.env.ACME_ENABLED !== "true") {
    res.status(200).json({
      status: "manual_required",
      domain: domain.domain,
      message: "Automatic TLS is not enabled on this node (ACME_ENABLED is not set). Use one of the options below:",
      options: {
        caddy: {
          description: "Recommended — Caddy handles TLS automatically",
          config: `${domain.domain} {\n  reverse_proxy localhost:${process.env.PORT ?? 8080}\n}`,
        },
        certbot: {
          description: "Run certbot on the server",
          command: `certbot certonly --standalone -d ${domain.domain}`,
          postInstall: `Set ACME_CERT_DIR to /etc/letsencrypt/live after running certbot`,
        },
        enable_acme: {
          description: "Enable built-in ACME provisioning",
          env: "ACME_ENABLED=true\nACME_EMAIL=you@example.com",
        },
      },
    });
    return;
  }

  // Check if cert already valid — skip unless --force
  if (certIsValid(domain.domain) && !req.query.force) {
    res.json({ status: "already_valid", domain: domain.domain, message: "Certificate is valid and not due for renewal. Use ?force=true to reprovision." });
    return;
  }

  // Kick off provisioning (async — respond immediately with job started)
  res.json({ status: "provisioning", domain: domain.domain, message: "Certificate provisioning started. This may take up to 60 seconds." });

  // Run provisioning after response is sent
  provisionCertificate(domain.domain).then((result) => {
    if (result.success) {
      logger.info({ domain: domain.domain, expiresAt: result.expiresAt }, "[acme] Provisioning complete");
    } else {
      logger.error({ domain: domain.domain, error: result.error }, "[acme] Provisioning failed");
    }
  });
}));

export default router;
