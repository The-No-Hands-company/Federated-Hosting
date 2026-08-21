import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { existsSync } from "fs";
import path from "path";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import { COMPRESSION_LEVEL } from "./lib/resourceConfig";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import { randomUUID } from "crypto";
import { authMiddleware } from "./middlewares/authMiddleware";
import { tokenAuthMiddleware } from "./middleware/tokenAuth";
import { globalErrorHandler, notFoundHandler } from "./middleware/errorHandler";
import { globalLimiter, speedLimiter } from "./middleware/rateLimiter";
import { apiBanMiddleware } from "./middleware/ipBan";
import { hostRouter } from "./middleware/hostRouter";
import router from "./routes";
import { metricsMiddleware, registry } from "./lib/metrics";
import { geoRoutingMiddleware } from "./lib/geoRouting";
import { db, nodesTable, siteDeploymentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { stripPemHeaders } from "./lib/federation";
import logger from "./lib/logger";

const isProd = process.env.NODE_ENV === "production";

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : true;

const app: Express = express();

// ── Trust reverse proxy headers (X-Forwarded-For, X-Real-IP) ────────────────────
// Required so express-rate-limit can correctly read X-Forwarded-For
app.set("trust proxy", 1);

// ── Security headers ──────────────────────────────────────────────────────────

// Origins permitted to frame this app — the ecosystem shell, which mounts it at
// app.<domain>/hosting.
//
// `frameguard: false` below only drops the legacy X-Frame-Options header. It
// does nothing about CSP, and helmet injects `frame-ancestors 'self'` into its
// default directives unless the directive is set explicitly. So framing stayed
// blocked by CSP while the comment claimed embedding was allowed, and the shell
// showed "Firefox Can't Open This Page" for /hosting.
const shellOrigins = process.env.SHELL_ORIGINS
  ? process.env.SHELL_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean)
  : [`https://app.${process.env.PUBLIC_DOMAIN ?? "tnhc.dev"}`];

app.use(
  helmet({
    contentSecurityPolicy: isProd
      ? {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'"],
            fontSrc: ["'self'", "https:"],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'"],
            frameSrc: ["'none'"],
            // Named explicitly: anything not listed here falls back to helmet's
            // default, which is 'self' alone.
            frameAncestors: ["'self'", ...shellOrigins],
          },
        }
      : false,
    // Allow the ecosystem shell to embed this service in an iframe
    frameguard: false,
    crossOriginEmbedderPolicy: false,
    hsts: isProd ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
  }),
);

// ── CORS ──────────────────────────────────────────────────────────────────────
app.use(cors({ credentials: true, origin: allowedOrigins }));

// ── Response compression ──────────────────────────────────────────────────────
app.use(compression({ level: COMPRESSION_LEVEL }));

// ── Request IDs ───────────────────────────────────────────────────────────────
app.use((req: Request, res: Response, next: NextFunction) => {
  const id = (req.headers["x-request-id"] as string) || randomUUID();
  req.headers["x-request-id"] = id;
  res.setHeader("X-Request-ID", id);
  next();
});

// ── Structured request logging ────────────────────────────────────────────────
app.use(
  pinoHttp({
    logger,
    quietReqLogger: true,
    customLogLevel: (_req, res, err) => {
      if (err || res.statusCode >= 500) return "error";
      if (res.statusCode >= 400) return "warn";
      if (res.statusCode >= 300) return "silent";
      return "info";
    },
    customSuccessMessage: (req, res) =>
      `${req.method} ${req.url} → ${res.statusCode}`,
    customErrorMessage: (_req, res, err) =>
      `${res.statusCode} — ${(err as Error)?.message ?? "unknown error"}`,
    serializers: {
      req: (req) => ({ method: req.method, url: req.url, id: req.id }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
  }),
);

// ── Body parsing (with size limits) ──────────────────────────────────────────
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(cookieParser());
app.use(authMiddleware);
app.use(tokenAuthMiddleware);
app.use(apiBanMiddleware);

// Block suspended users from using the API
app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (req.isAuthenticated() && (req.user as any)?.suspendedAt) {
    res.status(403).json({
      error: "Your account has been suspended. Contact the node operator.",
      code: "ACCOUNT_SUSPENDED",
    });
    return;
  }
  next();
});

// ── Rate limiting ─────────────────────────────────────────────────────────────
app.use(globalLimiter);
app.use(speedLimiter);

// ── Prometheus metrics instrumentation ────────────────────────────────────────
app.use(metricsMiddleware);

// GET /metrics — Prometheus scrape endpoint.
// Set METRICS_TOKEN to protect it; without it metrics are open (bind to localhost recommended).
app.get("/metrics", async (req: Request, res: Response) => {
  const token = process.env.METRICS_TOKEN;
  if (token && req.headers.authorization !== `Bearer ${token}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  res.setHeader("Content-Type", registry.contentType);
  res.end(await registry.metrics());
});


// ── Geographic routing (closest-node redirect) ────────────────────────────────
app.use(geoRoutingMiddleware);

// ── Phase 3: Host-header site routing ─────────────────────────────────────────
app.use(hostRouter);

// ── Federation discovery (well-known) ─────────────────────────────────────────
app.get("/.well-known/federation", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const [localNode] = await db.select().from(nodesTable).where(eq(nodesTable.isLocalNode, 1));
    const allNodes = await db.select().from(nodesTable);
    const activeDeployments = await db
      .select()
      .from(siteDeploymentsTable)
      .where(eq(siteDeploymentsTable.status, "active"));

    res.json({
      protocol: "nexushosting/1.0",
      name: localNode?.name ?? "Nexus Hosting Node",
      domain: localNode?.domain ?? process.env.PUBLIC_DOMAIN ?? "unknown",
      region: localNode?.region ?? "unknown",
      publicKey: localNode?.publicKey ? stripPemHeaders(localNode.publicKey) : null,
      nodeCount: allNodes.length,
      activeSites: activeDeployments.length,
      joinedAt: localNode?.joinedAt?.toISOString() ?? new Date().toISOString(),
      capabilities: ["site-hosting", "node-federation", "key-verification", "site-replication"],
    });
  } catch (err) {
    next(err);
  }
});

// ── ACME HTTP-01 challenge (must be at root, outside /api) ────────────────────
import tlsRouter from "./routes/tls";
app.use(tlsRouter);

// ── API routes ─────────────────────────────────────────────────────────────────
app.use("/api", router);

// ── Root status page (shown in Nexus Cloud portal iframe) ─────────────────────
// The operator's status page. It used to answer "/", which meant the front
// door of a hosting product was a page of API links — and the actual dashboard,
// built and copied into the image as ./public, was never served at all. Every
// one of its routes (/my-sites, /deploy/:id, /sites) answered with a JSON 404.
app.get("/status", (_req: Request, res: Response) => {
  const uptime = process.uptime();
  const h = Math.floor(uptime / 3600);
  const m = Math.floor((uptime % 3600) / 60);
  const s = Math.floor(uptime % 60);
  const uptimeStr = `${h}h ${m}m ${s}s`;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Nexus Hosting</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:system-ui,sans-serif;background:#0f1117;color:#e2e8f0;padding:24px;min-height:100vh}
    h1{font-size:1.4rem;font-weight:700;color:#fff;margin-bottom:4px}
    .sub{font-size:.85rem;color:#64748b;margin-bottom:24px}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:24px}
    .card{background:#1e2433;border:1px solid #2d3748;border-radius:8px;padding:14px}
    .label{font-size:.7rem;text-transform:uppercase;letter-spacing:.05em;color:#64748b;margin-bottom:4px}
    .value{font-size:1.1rem;font-weight:600;color:#a78bfa}
    .badge{display:inline-block;background:#14532d;color:#4ade80;font-size:.7rem;padding:2px 8px;border-radius:9999px;font-weight:600}
    a{color:#7c3aed;text-decoration:none}a:hover{text-decoration:underline}
    ul{list-style:none;display:flex;flex-direction:column;gap:6px}
    li a{display:flex;align-items:center;gap:6px;font-size:.85rem;color:#94a3b8}
    li a:hover{color:#e2e8f0;text-decoration:none}
  </style>
</head>
<body>
  <h1>Nexus Hosting <span class="badge">online</span></h1>
  <p class="sub">Decentralised static site hosting network — API server</p>
  <div class="grid">
    <div class="card"><div class="label">Uptime</div><div class="value">${uptimeStr}</div></div>
    <div class="card"><div class="label">Environment</div><div class="value">${process.env.NODE_ENV ?? "development"}</div></div>
  </div>
  <div class="card" style="margin-bottom:12px">
    <div class="label" style="margin-bottom:10px">Quick links</div>
    <ul>
      <li><a href="/api/health/live" target="_blank">▸ Health check</a></li>
      <li><a href="/api/sites" target="_blank">▸ Sites API</a></li>
      <li><a href="/api/admin/stats" target="_blank">▸ Admin stats</a></li>
      <li><a href="/.well-known/federation" target="_blank">▸ Federation manifest</a></li>
      <li><a href="/metrics" target="_blank">▸ Prometheus metrics</a></li>
    </ul>
  </div>
</body>
</html>`);
});

// ── Dashboard SPA ─────────────────────────────────────────────────────────────
//
/** True when `path` is `prefix` itself or sits beneath it as a path segment. */
function isSegment(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(prefix + "/");
}

// The OpenAPI description.
//
// The spec has lived in lib/api-spec/openapi.yaml for as long as this service
// has existed and was never served, so every openapi.json on every Nexus host
// answered 404 and no client could be generated against any of them. It is
// 13,000 lines of valid OpenAPI 3.1 that nothing could reach.
//
// Served as YAML rather than converted: js-yaml is not a dependency here, and
// adding one purely to re-emit the same document in another syntax buys
// nothing — Swagger UI, orval and openapi-generator all read YAML.
//
// It describes 50 of this service's 127 routes. That is not hidden: the
// x-nexus-coverage extension in the document records it, and a test in
// tests/unit/specCoverage.test.ts fails if the gap widens without anyone
// noticing. A partial spec is far more useful than none; a partial spec
// presented as complete is how the next person gets misled.
const OPENAPI_PATH = [
  path.resolve(process.cwd(), "api-spec/openapi.yaml"),
  path.resolve(process.cwd(), "lib/api-spec/openapi.yaml"),
  path.resolve(process.cwd(), "../../lib/api-spec/openapi.yaml"),
].find((candidate) => existsSync(candidate));

app.get(["/openapi.yaml", "/openapi.yml"], (_req, res) => {
  if (!OPENAPI_PATH) {
    res.status(404).type("text/plain").send("No OpenAPI description on this node.\n");
    return;
  }
  // Explicit charset: the spec contains em dashes and arrows in its
  // descriptions, and a bare text/yaml lets a browser guess latin-1.
  res.type("application/yaml; charset=utf-8").sendFile(OPENAPI_PATH);
});

// The node enrolment installer.
//
// Served explicitly rather than from the SPA directory: it lives with the API
// source, not the client build, and it must keep working whether or not a
// frontend has been built into this image at all. The enrolment response tells
// operators to curl this exact path, so it cannot depend on the SPA layout.
//
// text/plain, deliberately: an operator being asked to run a script on a
// machine they own should be able to click the URL and read every line of it
// in a browser before they do. Nothing here is minified or obscured.
const INSTALLER_PATH = [
  // Where the Dockerfile puts it. ./public is the client build, so it needs
  // its own directory.
  path.resolve(process.cwd(), "installer/install-node.sh"),
  path.resolve(process.cwd(), "public/install-node.sh"),
  path.resolve(process.cwd(), "src/../public/install-node.sh"),
  path.resolve(process.cwd(), "artifacts/api-server/public/install-node.sh"),
].find((candidate) => existsSync(candidate));

app.get("/install-node.sh", (_req, res) => {
  if (!INSTALLER_PATH) {
    res.status(404).type("text/plain").send("Installer not found on this node.\n");
    return;
  }
  res.type("text/plain").sendFile(INSTALLER_PATH);
});

// The built client. In the image it is ./public (see the Dockerfile's COPY of
// federated-hosting/dist); running from a checkout it sits in the workspace.
// Overridable so a node can serve a different build without a rebuild.
// Resolved by looking for index.html rather than assuming a layout. The client's
// vite config emits into dist/public, so the Dockerfile's
// `COPY .../federated-hosting/dist ./public` lands it at ./public/public — a
// nesting that is easy to miss and silently serves nothing. Candidates are
// ordered most-specific first; an explicit SPA_DIR always wins.
const SPA_DIR = [
  process.env["SPA_DIR"],
  path.resolve(process.cwd(), "public/public"),
  path.resolve(process.cwd(), "public"),
  path.resolve(process.cwd(), "../federated-hosting/dist/public"),
  path.resolve(process.cwd(), "../federated-hosting/dist"),
].find((dir): dir is string => !!dir && existsSync(path.join(dir, "index.html")))
  ?? path.resolve(process.cwd(), "public");

if (existsSync(path.join(SPA_DIR, "index.html"))) {
  // Hashed assets are immutable and safe to cache hard; index.html must not be,
  // or a browser keeps asking for a bundle that no longer exists after a deploy.
  app.use(
    express.static(SPA_DIR, {
      index: false,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith("index.html")) {
          res.setHeader("Cache-Control", "no-cache");
        } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    }),
  );

  // Client-side routes resolve to index.html so a deep link or a refresh works.
  //
  // Deliberately narrow. Anything under /api, /metrics or /.well-known that got
  // this far is a genuine 404 and must say so — answering HTML there turns a
  // mistyped API call into a caller parsing "<!doctype html>" as JSON. Same for
  // non-GET, and for requests that did not ask for HTML.
  app.get(/.*/, (req: Request, res: Response, next: NextFunction) => {
    if (
      // Segment-aware, not prefix. `startsWith("/api")` also matches
      // "/api-docs", so the API-docs page was excluded from the SPA fallback
      // and fell through to the API 404 handler — the route rendered in a
      // browser but answered 404, because Express mounts the router
      // segment-aware and nothing actually served it. Any future
      // "/api-something" page would have hit the same wall.
      isSegment(req.path, "/api") ||
      isSegment(req.path, "/metrics") ||
      isSegment(req.path, "/.well-known") ||
      // A path with an extension is asking for a file, not a route. Without
      // this, a missing .js/.json/.css answers 200 with index.html: `fetch`
      // and dynamic `import()` both send `Accept: */*`, which counts as
      // accepting HTML, so the check below waves them through. A dynamic
      // import that receives HTML throws, and since every page here is a lazy
      // chunk, one missing asset breaks all of them with an error that names
      // nothing useful. A 404 is the honest answer and says where to look.
      path.extname(req.path) !== "" ||
      !req.accepts("html")
    ) {
      return next();
    }
    // Explicit: sendFile does not pass through the static middleware above, so
    // it would otherwise inherit a plain max-age and could be served stale —
    // an entry point pointing at a bundle hash that no longer exists.
    res.setHeader("Cache-Control", "no-cache");
    return res.sendFile(path.join(SPA_DIR, "index.html"));
  });
} else {
  // Say so rather than silently serving 404s for every dashboard route.
  logger.warn(
    { spaDir: SPA_DIR },
    "Dashboard build not found — the hosting UI will not be served. Build artifacts/federated-hosting, or set SPA_DIR.",
  );
}

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use(notFoundHandler);

// ── Global error handler (must be last) ───────────────────────────────────────
app.use(globalErrorHandler);

export default app;
