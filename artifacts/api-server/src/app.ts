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

// ── Auth middleware ────────────────────────────────────────────────────────────
app.use(authMiddleware);

// ── Token-based auth (for CLI / API clients) ──────────────────────────────────
app.use(tokenAuthMiddleware);

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

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use(notFoundHandler);

// ── Global error handler (must be last) ───────────────────────────────────────
app.use(globalErrorHandler);

export default app;
