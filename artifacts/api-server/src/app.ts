import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import { randomUUID } from "crypto";
import { authMiddleware } from "./middlewares/authMiddleware";
import { globalErrorHandler, notFoundHandler } from "./middleware/errorHandler";
import { globalLimiter, speedLimiter } from "./middleware/rateLimiter";
import router from "./routes";
import { hostRouter } from "./middleware/hostRouter";
import { db, nodesTable, siteDeploymentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { stripPemHeaders } from "./lib/federation";
import logger from "./lib/logger";

const isProd = process.env.NODE_ENV === "production";

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : true;

const app: Express = express();

// ── Trust proxy (Replit / reverse-proxy environments) ─────────────────────────
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
app.use(compression());

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

// ── Rate limiting ─────────────────────────────────────────────────────────────
app.use(globalLimiter);
app.use(speedLimiter);

// ── Auth middleware ────────────────────────────────────────────────────────────
app.use(authMiddleware);

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
      protocol: "fedhost/1.0",
      name: localNode?.name ?? "Federated Hosting Node",
      domain: localNode?.domain ?? process.env.REPLIT_DEV_DOMAIN ?? "unknown",
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

// ── API routes ─────────────────────────────────────────────────────────────────
app.use("/api", router);

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use(notFoundHandler);

// ── Global error handler (must be last) ───────────────────────────────────────
app.use(globalErrorHandler);

export default app;
