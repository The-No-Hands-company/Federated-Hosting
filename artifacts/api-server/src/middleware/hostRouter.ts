import { type Request, type Response, type NextFunction } from "express";
import { db, sitesTable, siteFilesTable, analyticsBufferTable, customDomainsTable, siteRedirectRulesTable, siteCustomHeadersTable, ipBansTable } from "@workspace/db";
import { eq, and, isNull, or, gt } from "drizzle-orm";
import { storage, ObjectNotFoundError } from "../lib/storageProvider";
import { hashIp } from "../lib/analyticsFlush";
import { getClientIp } from "./ipBan.js";
import crypto from "crypto";
import http from "http";
import { getCachedSite, setCachedSite, getCachedFile, setCachedFile } from "../lib/domainCache";
import { getSiteProxyTarget } from "../lib/processManager";
import logger from "../lib/logger";
import fs from "fs";
import path from "path";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";

// Per-IP-per-host rate limit on site serving — prevents bandwidth/scraping abuse.
// 600 req/min per IP per host in production (~10 req/s sustained).
// Created once at module init (not inside request handler) to satisfy express-rate-limit v8.
const serveLimiter = rateLimit({
  windowMs: 60_000,
  max: process.env.NODE_ENV === "production" ? 600 : 100_000,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}:${req.hostname}`,
  handler: (_req, res) => res.status(429).send("Too Many Requests"),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: (req) => req.ip === "127.0.0.1" || req.ip === "::1",
});
function getServeLimiter(_host: string) {
  return serveLimiter;
}

const PUBLIC_DOMAIN = process.env.PUBLIC_DOMAIN ?? "";

// Load password gate HTML at startup — avoids fs.readFileSync on every request
let _passwordGateHtml: string | null = null;
function getPasswordGateHtml(): string {
  if (!_passwordGateHtml) {
    const p = path.join(process.cwd(), "public", "password-gate.html");
    _passwordGateHtml = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "<h1>Password Required</h1>";
  }
  return _passwordGateHtml;
}

function getCacheControl(contentType: string): string {
  // HTML: always revalidate — users must see fresh content
  if (contentType.includes("text/html")) return "public, max-age=0, must-revalidate";
  // Hashed assets (JS/CSS bundles, fonts, images) — immutable 1 year
  if (
    contentType.includes("javascript") ||
    contentType.includes("text/css") ||
    contentType.includes("font/") ||
    contentType.includes("image/webp") ||
    contentType.includes("image/avif")
  ) return "public, max-age=31536000, immutable";
  // Images and other media — 1 week
  if (contentType.startsWith("image/") || contentType.startsWith("video/") || contentType.startsWith("audio/"))
    return "public, max-age=604800";
  // JSON/XML data — 5 minutes
  if (contentType.includes("json") || contentType.includes("xml"))
    return "public, max-age=300";
  // Default — 1 hour
  return "public, max-age=3600";
}

function buildETag(objectPath: string, sizeBytes: number): string {
  // Weak ETag based on objectPath (unique per content) + size
  const raw = `${objectPath}:${sizeBytes}`;
  let h = 0;
  for (let i = 0; i < raw.length; i++) { h = Math.imul(31, h) + raw.charCodeAt(i) | 0; }
  return `W/"${Math.abs(h).toString(16)}"`;
}

function isKnownInfraHost(host: string): boolean {
  if (!host) return true;
  if (host.startsWith("localhost")) return true;
  if (PUBLIC_DOMAIN && host.includes(PUBLIC_DOMAIN)) return true;
  return false;
}

function recordHit(siteId: number, path: string, req: Request, bytesServed: number): void {
  const rawIp = req.ip ?? req.socket.remoteAddress ?? "";
  const ipHash = rawIp ? hashIp(rawIp) : null;
  const referrer = (req.headers["referer"] as string | undefined) ?? null;
  db.insert(analyticsBufferTable)
    .values({ siteId, path, referrer, ipHash, bytesServed })
    .catch(() => {});

  // Broadcast to any SSE subscribers watching this site in real-time
  import("../routes/analytics").then(m => {
    m.broadcastAnalyticsHit(siteId, path, referrer);
  }).catch(() => {});
}

/** Verify HMAC-signed unlock cookie issued by POST /api/sites/:id/unlock */
function verifyUnlockCookie(cookieValue: string | undefined, siteId: number): boolean {
  if (!cookieValue) return false;
  try {
    const secret = process.env.COOKIE_SECRET ?? (process.env.NODE_ENV === "production" ? (() => { throw new Error("COOKIE_SECRET must be set in production"); })() : "dev-only-insecure-cookie-secret");
    const [encodedPayload, hmac] = cookieValue.split(".");
    if (!encodedPayload || !hmac) return false;
    const payload = Buffer.from(encodedPayload, "base64url").toString();
    const [cookieSiteId, issuedAt] = payload.split(":");
    if (parseInt(cookieSiteId, 10) !== siteId) return false;
    const age = Math.floor(Date.now() / 1000) - parseInt(issuedAt, 10);
    if (age > 86400) return false;
    const expectedHmac = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
    return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(expectedHmac));
  } catch {
    return false;
  }
}

function renderPasswordGate(siteId: number, domain: string, message?: string | null): string {
  return getPasswordGateHtml().replace(
    "<body>",
    `<body data-site-id="${siteId}" data-domain="${domain.replace(/"/g, "&quot;")}"${message ? ` data-message="${message.replace(/"/g, "&quot;")}"` : ""}>`
  );
}

/**
 * Match a request path against a redirect source pattern.
 * Supports: /exact, /blog/:slug, /old/* (splat)
 * Returns a match object with named params and splat, or null if no match.
 */
/**
 * Match a request path (and optional query string) against a redirect source pattern.
 *
 * Supported patterns:
 *   /exact                 — exact path match
 *   /blog/:slug            — named :param segments
 *   /old/*                 — splat (matches everything after prefix)
 *   /page?utm_source=*     — query string matching (?key=value, ?key=* wildcard)
 *   /path?!key             — query string negation (matches if key is absent)
 *   ^/regex.*$             — raw regex (prefix with ^)
 *
 * Returns a params object on match, null on no match.
 */
function matchRedirectPattern(
  reqPath: string,
  reqQuery: string, // raw query string e.g. "utm_source=email&ref=abc"
  pattern: string
): Record<string, string> | null {
  // ── Regex patterns (start with ^) ────────────────────────────────────────
  if (pattern.startsWith("^")) {
    try {
      const re = new RegExp(pattern, "i");
      const full = reqQuery ? `${reqPath}?${reqQuery}` : reqPath;
      const m = full.match(re);
      if (!m) return null;
      return m.groups ?? {};
    } catch { return null; }
  }

  // ── Split pattern into path and query parts ───────────────────────────────
  const qMark = pattern.indexOf("?");
  const pathPattern   = qMark === -1 ? pattern : pattern.slice(0, qMark);
  const queryPattern  = qMark === -1 ? null : pattern.slice(qMark + 1);

  // ── Path matching ─────────────────────────────────────────────────────────
  const normReq = reqPath.endsWith("/") && reqPath !== "/" ? reqPath.slice(0, -1) : reqPath;
  const normPat = pathPattern.endsWith("/") && pathPattern !== "/" ? pathPattern.slice(0, -1) : pathPattern;

  const params: Record<string, string> = {};

  if (normPat.endsWith("/*")) {
    const prefix = normPat.slice(0, -2);
    if (normReq !== prefix && !normReq.startsWith(prefix + "/")) return null;
    params["*"] = normReq.slice(prefix.length + 1);
  } else {
    const patParts = normPat.split("/");
    const reqParts = normReq.split("/");
    if (patParts.length !== reqParts.length) return null;
    for (let i = 0; i < patParts.length; i++) {
      if (patParts[i]!.startsWith(":")) {
        params[patParts[i]!.slice(1)] = decodeURIComponent(reqParts[i]!);
      } else if (patParts[i] !== reqParts[i]) {
        return null;
      }
    }
  }

  // ── Query string matching ─────────────────────────────────────────────────
  if (queryPattern) {
    const actualQuery = new URLSearchParams(reqQuery);
    const rules = queryPattern.split("&");
    for (const rule of rules) {
      if (rule.startsWith("!")) {
        // Negation: key must be absent
        if (actualQuery.has(rule.slice(1))) return null;
      } else {
        const eqIdx = rule.indexOf("=");
        if (eqIdx === -1) {
          // Key must be present (any value)
          if (!actualQuery.has(rule)) return null;
        } else {
          const key = rule.slice(0, eqIdx);
          const val = rule.slice(eqIdx + 1);
          const actual = actualQuery.get(key);
          if (actual === null) return null;
          if (val !== "*" && val !== actual) return null;
          if (val === "*") params[`q_${key}`] = actual; // capture wildcard query values
        }
      }
    }
  }

  return params;
}

/** Interpolate :param and * placeholders in redirect destination */
function interpolateDest(dest: string, params: Record<string, string>): string {
  let result = dest;
  for (const [k, v] of Object.entries(params)) {
    result = result.replace(`:${k}`, v).replace("*", v);
  }
  return result;
}

/** Apply matching custom response headers to the response */
function applyCustomHeaders(
  res: import("express").Response,
  reqPath: string,
  rules: Array<{ path: string; name: string; value: string }>,
): void {
  for (const rule of rules) {
    if (matchRedirectPattern(reqPath, "", rule.path) !== null) {
      // Only set safe headers — block headers that could break the response
      const lower = rule.name.toLowerCase();
      if (lower === "content-length" || lower === "transfer-encoding" || lower === "connection") continue;
      res.setHeader(rule.name, rule.value);
    }
  }
}

export async function hostRouter(req: Request, res: Response, next: NextFunction): Promise<void> {
  const host = req.hostname;
  if (!host || isKnownInfraHost(host)) { next(); return; }

  // Apply per-IP rate limit for this host before doing anything else
  await new Promise<void>((resolve) => getServeLimiter(host)(req, res, () => resolve()));
  if (res.headersSent) return; // rate limit handler already responded

  // ── Staging subdomain resolution ─────────────────────────────────────────
  // staging.mysite.example.com → serves the latest staging deployment for mysite.example.com
  // preview.mysite.example.com → same for preview deployments
  let forcedEnvironment: string | null = null;
  let effectiveHost = host;

  const stagingPrefixes = ["staging.", "preview."];
  for (const prefix of stagingPrefixes) {
    if (host.startsWith(prefix)) {
      effectiveHost = host.slice(prefix.length);
      forcedEnvironment = prefix.slice(0, -1); // "staging" or "preview"
      break;
    }
  }

  // ── Domain lookup (cache-first) ───────────────────────────────────────────
  let site: typeof sitesTable.$inferSelect | null = null;

  const cached = getCachedSite(effectiveHost);
  if (cached && !forcedEnvironment) {
    // Reconstruct minimal site object from cache (only for production — staging bypasses cache)
    site = {
      id: cached.siteId, domain: cached.domain,
      visibility: cached.visibility, passwordHash: cached.passwordHash,
      unlockMessage: cached.unlockMessage,
    } as typeof sitesTable.$inferSelect;
  } else {
    // Cache miss — query DB
    const [byPrimary] = await db.select().from(sitesTable).where(eq(sitesTable.domain, effectiveHost));
    if (byPrimary) {
      site = byPrimary;
    } else {
      const [customDomain] = await db
        .select({ siteId: customDomainsTable.siteId })
        .from(customDomainsTable)
        .where(and(eq(customDomainsTable.domain, effectiveHost), eq(customDomainsTable.status, "verified")));
      if (customDomain) {
        const [bySiteId] = await db.select().from(sitesTable).where(eq(sitesTable.id, customDomain.siteId));
        if (bySiteId) site = bySiteId;
      }
    }

    // Populate cache only for production requests (staging bypasses cache to stay fresh)
    if (site && !forcedEnvironment) {
      setCachedSite({
        siteId: site.id,
        domain: effectiveHost,
        visibility: (site.visibility as "public" | "private" | "password") ?? "public",
        passwordHash: site.passwordHash ?? null,
        unlockMessage: (site as any).unlockMessage ?? null,
      });
    }
  }

  if (!site) { next(); return; }

  // ── IP ban check (sites scope) ────────────────────────────────────────────
  // Check before serving any content — banned IPs get a plain 403.
  // Uses the same ban table as the API middleware; cached for 60 seconds.
  const visitorIp = getClientIp(req);
  if (visitorIp && visitorIp !== "127.0.0.1" && visitorIp !== "::1") {
    const now = new Date();
    const [ban] = await db
      .select({ scope: ipBansTable.scope })
      .from(ipBansTable)
      .where(and(
        eq(ipBansTable.ipAddress, visitorIp),
        or(isNull(ipBansTable.expiresAt), gt(ipBansTable.expiresAt, now)),
      ))
      .limit(1);
    if (ban && (ban.scope === "all" || ban.scope === "sites")) {
      res.status(403).send("Access denied.");
      return;
    }
  }

  // ── Site status checks ────────────────────────────────────────────────────
  const siteStatus = (site as any).status as string | undefined;

  if (siteStatus === "maintenance") {
    const msg = (site as any).maintenanceMessage as string | undefined;
    res.status(503)
      .setHeader("Retry-After", "3600")
      .send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Maintenance</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,sans-serif;background:#0a0a0f;color:#e4e4f0;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:2rem}h1{font-size:2rem;margin-bottom:1rem}p{color:#9ca3af;max-width:40ch;line-height:1.6}</style>
</head><body><div><h1>🔧 Under Maintenance</h1><p>${msg ? msg.replace(/</g, "&lt;") : "We&rsquo;re making some improvements. Back soon."}</p></div></body></html>`);
    return;
  }

  if (siteStatus === "suspended") {
    res.status(451).send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Suspended</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,sans-serif;background:#0a0a0f;color:#e4e4f0;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:2rem}h1{font-size:2rem;margin-bottom:1rem}p{color:#9ca3af}</style>
</head><body><div><h1>Site Suspended</h1><p>This site has been suspended. If you own this site, contact the node operator.</p></div></body></html>`);
    return;
  }

  if (site.visibility === "private") {
    res.status(403).send(`<!DOCTYPE html><html><body style="font-family:system-ui;background:#0a0a0f;color:#e4e4f0;display:flex;align-items:center;justify-content:center;min-height:100vh;"><div style="text-align:center"><h1>403</h1><p>This site is private.</p></div></body></html>`);
    return;
  }

  if (site.visibility === "password" && !verifyUnlockCookie(req.cookies?.[`site_unlock_${site.id}`], site.id)) {
    res.status(401).send(renderPasswordGate(site.id, host, (site as any).unlockMessage));
    return;
  }

  // ── Dynamic site: proxy to the site's running process ────────────────────
  // Sites with siteType "nlpl", "node", or "python" run as persistent processes.
  // The processManager allocates a port and keeps the process alive.
  // Here we simply forward the HTTP request to that process.
  const siteType = (site as any).siteType as string | undefined;
  if (siteType === "nlpl" || siteType === "node" || siteType === "python" || siteType === "dynamic") {
    const proxyTarget = getSiteProxyTarget(site.id);

    if (!proxyTarget) {
      // Process isn't running — return a clear error rather than hanging
      res.status(503).send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>Site Starting</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,sans-serif;background:#0a0a0f;color:#e4e4f0;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:2rem}h1{font-size:2rem;margin-bottom:1rem;color:#7c6af7}p{color:#9ca3af;max-width:40ch;line-height:1.6}code{font-family:monospace;font-size:.85em;background:#1a1a2e;padding:.2em .4em;border-radius:.25em}</style>
</head><body><div>
<h1>⚡ Site is starting</h1>
<p>The <code>${siteType}</code> process for this site is not running yet.</p>
<p style="margin-top:1rem;font-size:.85em">Deploy the site or check the node admin panel to start the process.</p>
</div></body></html>`);
      return;
    }

    // Parse proxy target URL
    const targetUrl = new URL(req.url, proxyTarget);

    const proxyReq = http.request(
      {
        host: "127.0.0.1",
        port: new URL(proxyTarget).port,
        path: req.url,
        method: req.method,
        headers: {
          ...req.headers,
          host: host,  // forward original host header
          "x-forwarded-for": req.ip ?? "",
          "x-forwarded-proto": "https",
          "x-site-domain": host,
        },
      },
      (proxyRes) => {
        res.status(proxyRes.statusCode ?? 200);
        for (const [key, val] of Object.entries(proxyRes.headers)) {
          if (val !== undefined) res.setHeader(key, val);
        }
        res.setHeader("X-Served-By", "nexus-hosting-proxy");
        proxyRes.pipe(res);
        recordHit(site.id, req.path, req, 0);
      },
    );

    proxyReq.on("error", (err) => {
      logger.warn({ siteId: site.id, domain: host, err: (err as Error).message }, "[host-router] Proxy error");
      if (!res.headersSent) {
        res.status(502).send("Bad gateway — site process error");
      }
    });

    if (req.body) {
      const bodyData = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
      proxyReq.write(bodyData);
    }
    proxyReq.end();
    return;
  }

  const requestedPath = req.path === "/" ? "index.html" : req.path.replace(/^\//, "");

  // ── Auto-generated files ──────────────────────────────────────────────────
  // Serve dynamic sitemap.xml if the site doesn't have one
  if (requestedPath === "sitemap.xml") {
    const siteFiles = await db.select({ filePath: siteFilesTable.filePath })
      .from(siteFilesTable)
      .where(and(eq(siteFilesTable.siteId, site.id),
        eq(siteFilesTable.contentType, "text/html")));

    const baseUrl = `https://${host}`;
    const urls = siteFiles
      .map(f => f.filePath.replace(/\/?(index\.html)$/, "/").replace(/^([^/])/, "/$1"))
      .filter((v, i, a) => a.indexOf(v) === i)
      .map(p => `  <url><loc>${baseUrl}${p}</loc></url>`)
      .join("\n");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;
    res.setHeader("Content-Type", "application/xml");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.send(xml);
    return;
  }

  // Serve minimal robots.txt if the site doesn't have one
  if (requestedPath === "robots.txt") {
    const [existing] = await db.select({ filePath: siteFilesTable.filePath })
      .from(siteFilesTable)
      .where(and(eq(siteFilesTable.siteId, site.id), eq(siteFilesTable.filePath, "robots.txt")));
    if (!existing) {
      res.setHeader("Content-Type", "text/plain");
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.send(`User-agent: *\nAllow: /\nSitemap: https://${host}/sitemap.xml\n`);
      return;
    }
  }

  // ── Redirect rules ────────────────────────────────────────────────────────
  // Evaluate in position order. First match wins.
  // Status 200 = rewrite (serve dest transparently), all others = redirect.
  const redirectRules = await db
    .select()
    .from(siteRedirectRulesTable)
    .where(eq(siteRedirectRulesTable.siteId, site.id))
    .orderBy(siteRedirectRulesTable.position);

  for (const rule of redirectRules) {
    const rawQuery = typeof req.query === "object" ? new URLSearchParams(req.query as any).toString() : String(req.query ?? "");
    const match = matchRedirectPattern(req.path, rawQuery, rule.src);
    if (match) {
      const dest = interpolateDest(rule.dest, match);
      if (rule.status === 200) {
        // Rewrite: serve dest path transparently
        const rewritePath = dest.replace(/^\//, "");
        const [fileRecord] = await db.select().from(siteFilesTable)
          .where(and(eq(siteFilesTable.siteId, site.id), eq(siteFilesTable.filePath, rewritePath)));
        if (fileRecord) {
          applyCustomHeaders(res, req.path, await db.select().from(siteCustomHeadersTable).where(eq(siteCustomHeadersTable.siteId, site.id)));
          res.setHeader("Content-Type", fileRecord.contentType);
          res.setHeader("X-Served-By", "nexus-hosting");
          res.setHeader("Cache-Control", "public, max-age=3600");
          await storage.streamToResponse(fileRecord.objectPath, res);
          recordHit(site.id, rewritePath, req, fileRecord.sizeBytes ?? 0);
          return;
        }
      } else if (rule.status === 404) {
        res.status(404).send("<!DOCTYPE html><html><head><title>404</title></head><body style=\"font-family:system-ui;background:#0a0a0f;color:#e4e4f0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0\"><div style=\"text-align:center\"><h1 style=\"font-size:4rem;font-weight:900;color:#00e5ff\">404</h1><p>Not found</p></div></body></html>");
        return;
      } else if (rule.status === 410) {
        res.status(410).send("<!DOCTYPE html><html><head><title>410 Gone</title></head><body style=\"font-family:system-ui;background:#0a0a0f;color:#e4e4f0;display:flex;align-items:center;justify-content:center;min-height:100vh\"><div style=\"text-align:center\"><h1 style=\"font-size:4rem;font-weight:900;color:#f87171\">410</h1><p>Gone</p></div></body></html>");
        return;
      } else {
        res.redirect(rule.status, dest);
        return;
      }
    }
  }

  // ── Custom response headers ───────────────────────────────────────────────
  const customHeaders = await db.select().from(siteCustomHeadersTable)
    .where(eq(siteCustomHeadersTable.siteId, site.id));

  const serveFile = async (filePath: string): Promise<boolean> => {
    const [fileRecord] = await db
      .select()
      .from(siteFilesTable)
      .where(and(eq(siteFilesTable.siteId, site!.id), eq(siteFilesTable.filePath, filePath)));
    if (!fileRecord) return false;
    try {
      applyCustomHeaders(res, req.path, customHeaders);
      res.setHeader("Content-Type",  fileRecord.contentType);
      res.setHeader("X-Served-By",   "nexus-hosting");
      res.setHeader("X-Site-Domain", site!.domain);
      res.setHeader("Cache-Control", getCacheControl(fileRecord.contentType));

      // ETag for conditional GET — avoids re-downloading unchanged files
      const etag = buildETag(fileRecord.objectPath, fileRecord.sizeBytes ?? 0);
      res.setHeader("ETag", etag);
      if (req.headers["if-none-match"] === etag) {
        res.status(304).end();
        return true;
      }
      await storage.streamToResponse(fileRecord.objectPath, res);
      recordHit(site!.id, filePath, req, fileRecord.sizeBytes ?? 0);
      return true;
    } catch (err) {
      if (err instanceof ObjectNotFoundError) return false;
      throw err;
    }
  };

  try {
    const found = await serveFile(requestedPath);
    if (!found && requestedPath !== "index.html") {
      // Try custom 404.html first, then SPA fallback (index.html), then generic
      const custom404 = await serveFile("404.html");
      if (!custom404) {
        const spaFallback = await serveFile("index.html");
        if (!spaFallback) {
          res.status(404).send("<!DOCTYPE html><html><head><title>404</title></head><body style=\"font-family:system-ui;background:#0a0a0f;color:#e4e4f0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0\"><div style=\"text-align:center\"><h1 style=\"font-size:4rem;font-weight:900;color:#00e5ff\">404</h1><p>Page not found</p></div></body></html>");
        }
      }
      return;
    }
    if (!found) {
      res.status(404).send("<!DOCTYPE html><html><head><title>404</title></head><body style=\"font-family:system-ui;background:#0a0a0f;color:#e4e4f0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0\"><div style=\"text-align:center\"><h1 style=\"font-size:4rem;font-weight:900;color:#00e5ff\">404</h1><p>No index.html found</p></div></body></html>");
    }
  } catch {
    res.status(500).send("<!DOCTYPE html><html><body><h1>Server Error</h1></body></html>");
  }
}
