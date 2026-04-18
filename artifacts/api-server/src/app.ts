import * as Sentry from "@sentry/node";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import swaggerUi from "swagger-ui-express";
import router from "./routes";
import { logger } from "./lib/logger";
import { compatibilityGuard } from "./middlewares/compatibilityGuard";
import { openapiSpec } from "./lib/openapi";
import { recordHttpRequest, recordError, renderMetrics } from "./lib/metrics";

// ── Sentry (optional — only initialises if SENTRY_DSN is set) ──────────────
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? "development",
    tracesSampleRate: 0.1,
  });
  logger.info("Sentry error tracking enabled");
}

const app: Express = express();

// Trust the first proxy hop (Replit / reverse proxy) so req.ip reflects
// the real client address from X-Forwarded-For safely.
app.set("trust proxy", 1);

// ── Security headers (X-Content-Type-Options, X-Frame-Options, HSTS, etc.) ──
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        // shadcn/ui + Vite need inline styles; YouTube iframes load images from i.ytimg.com
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
        imgSrc: ["'self'", "data:", "blob:", "https:"],
        // Allow YouTube embeds in the public Docs page (admin-managed video tutorials)
        frameSrc: ["'self'", "https://www.youtube.com", "https://www.youtube-nocookie.com"],
        // Allow self-hosted scripts; remove this if you can drop inline scripts
        scriptSrc: ["'self'", "'unsafe-inline'"],
        connectSrc: ["'self'", "https://*.googleapis.com", "https://*.sentry.io"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'self'"],
        upgradeInsecureRequests: [],
      },
    },
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginEmbedderPolicy: false,
  }),
);

// ── Request logging ──────────────────────────────────────────────────────────
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

// ── Prometheus metrics middleware ────────────────────────────────────────────
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  res.on("finish", () => {
    recordHttpRequest(req.method, res.statusCode, req.path, Date.now() - start);
  });
  next();
});

// ── Request timeout middleware ────────────────────────────────────────────────
// Video generation / polling routes need a longer window; everything else
// gets 120 s which is ample even for large Gemini 3.1-Pro responses.
// Streaming responses are excluded — the socket stays open intentionally while
// chunks are flowing (SSE / NDJSON), so we only close if *no data* is sent.
app.use((req: Request, res: Response, next: NextFunction) => {
  const path = req.path;
  const isVideoRoute = path.includes("/v1/video") || path.includes("/video/");
  const isStreaming  = (req.body as Record<string, unknown> | undefined)?.stream === true;

  // Video generation can legitimately poll for minutes; streaming pushes chunks
  // continuously so a socket timeout would kill live responses mid-flight.
  const timeoutMs = isVideoRoute ? 300_000 : isStreaming ? 0 : 120_000;

  if (timeoutMs > 0) {
    res.setTimeout(timeoutMs, () => {
      if (!res.headersSent) {
        res.status(503).json({
          error:
            "Request timeout — the upstream model took too long to respond. " +
            "Please try again or choose a faster model.",
        });
      }
    });
  }

  next();
});

// ── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",").map((o) => o.trim())
  : true;

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  }),
);

// ── Body parsing ─────────────────────────────────────────────────────────────
// Webhook routes need raw body for HMAC verification — must be registered
// BEFORE express.json() consumes the body. Mount at both /webhooks and
// /api/webhooks so the routes work regardless of mount path.
app.use("/webhooks/chargily", express.raw({ type: "application/json", limit: "1mb" }));
app.use("/api/webhooks/chargily", express.raw({ type: "application/json", limit: "1mb" }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(cookieParser());

// ── API Documentation (Swagger UI) ───────────────────────────────────────────
const swaggerOptions = {
  customCss: ".swagger-ui .topbar { display: none }",
  customSiteTitle: "AI Gateway API Docs",
  swaggerOptions: {
    persistAuthorization: true,
    displayRequestDuration: true,
    filter: true,
  },
};

app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(openapiSpec, swaggerOptions));
app.use("/docs", swaggerUi.serve, swaggerUi.setup(openapiSpec, swaggerOptions));
app.get("/api/openapi.json", (_req, res) => res.json(openapiSpec));
app.get("/openapi.json", (_req, res) => res.json(openapiSpec));

// ── Prometheus metrics endpoint ───────────────────────────────────────────────
app.get("/metrics", (_req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
  res.send(renderMetrics());
});

// ── Compatibility guard for /v1/* (strips prototype-pollution keys) ──────────
app.use("/api/v1", compatibilityGuard);
app.use("/v1", compatibilityGuard);

// ── API routes ────────────────────────────────────────────────────────────────
app.use("/api", router);
app.use("/", router);

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "Not found" });
});

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = err instanceof Error ? err.message : "Internal server error";
  const isProd = process.env.NODE_ENV === "production";
  logger.error({ err }, "Unhandled error");
  recordError("unhandled");

  if (process.env.SENTRY_DSN) {
    Sentry.captureException(err);
  }

  res.status(500).json({
    error: isProd ? "Internal server error" : message,
  });
});

export default app;
