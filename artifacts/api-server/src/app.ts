import express, { type Express, type Request, type Response, type NextFunction } from "express";
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
          },
        }
      : false,
    // Allow Nexus Cloud portal to embed this service in an iframe
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
app.get("/", (_req: Request, res: Response) => {
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

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use(notFoundHandler);

// ── Global error handler (must be last) ───────────────────────────────────────
app.use(globalErrorHandler);

export default app;
