import type { Server } from "node:http";
import app from "./app";
import { logger } from "./lib/logger";
import { runSeed } from "./seed";
import { warmModelCostsCache } from "./lib/billing";
import { cleanupExpiredIpLimits } from "./lib/ipRateLimit";
import { startSubscriptionRolloverScheduler } from "./lib/subscription";
import { pool } from "@workspace/db";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Cleanup expired IP rate limit records every 60 minutes
const IP_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
cleanupExpiredIpLimits().catch((err) =>
  logger.warn({ err }, "Initial IP rate limit cleanup failed — continuing"),
);
const cleanupTimer = setInterval(() => {
  cleanupExpiredIpLimits().catch((err) =>
    logger.warn({ err }, "Scheduled IP rate limit cleanup failed"),
  );
}, IP_CLEANUP_INTERVAL_MS);
cleanupTimer.unref();

// Daily subscription rollover: auto-renew Free plans, lapse paid plans
const subscriptionTimer = startSubscriptionRolloverScheduler();
subscriptionTimer.unref();

// ── Graceful shutdown ─────────────────────────────────────────────────────────
function shutdown(server: Server, signal: string): void {
  logger.info({ signal }, "Shutdown signal received — draining connections");

  // Stop accepting new connections; wait for in-flight requests to finish
  server.close(async () => {
    logger.info("HTTP server closed — shutting down DB pool");
    try {
      await pool.end();
      logger.info("DB pool closed — exiting cleanly");
    } catch (err) {
      logger.warn({ err }, "DB pool close error (non-fatal)");
    }
    process.exit(0);
  });

  // Force-kill after 30 s if requests don't drain
  setTimeout(() => {
    logger.error("Graceful shutdown timeout — forcing exit");
    process.exit(1);
  }, 30_000).unref();
}

// Run seed on startup (idempotent — safe to run every time)
runSeed()
  .catch((err) => logger.error({ err }, "Seed failed on startup — continuing"))
  .then(() => warmModelCostsCache())
  .catch((err) => logger.error({ err }, "Failed to warm billing cache — continuing"))
  .finally(() => {
    const server = app.listen(port, (err?: Error) => {
      if (err) {
        logger.error({ err }, "Error listening on port");
        process.exit(1);
      }
      logger.info({ port }, "Server listening");
    });

    process.once("SIGTERM", () => shutdown(server, "SIGTERM"));
    process.once("SIGINT",  () => shutdown(server, "SIGINT"));
  });
