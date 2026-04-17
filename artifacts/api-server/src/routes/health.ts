import { Router, type IRouter } from "express";
import { db, healthSnapshotsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const startedAt = Date.now();

// Throttle snapshot writes — at most 1 per 30s to avoid table bloat from
// load-balancer probes.
let lastSnapshotAt = 0;
const SNAPSHOT_INTERVAL_MS = 30_000;

async function healthHandler(_req: Parameters<Parameters<typeof router.get>[1]>[0], res: Parameters<Parameters<typeof router.get>[1]>[1]) {
  const t0 = Date.now();
  let dbOk = false;
  let dbLatencyMs = -1;

  try {
    await db.execute(sql`SELECT 1`);
    dbLatencyMs = Date.now() - t0;
    dbOk = true;
  } catch {
    dbLatencyMs = Date.now() - t0;
  }

  // Persist snapshot for /status uptime calc — fire-and-forget, throttled
  if (Date.now() - lastSnapshotAt >= SNAPSHOT_INTERVAL_MS) {
    lastSnapshotAt = Date.now();
    db.insert(healthSnapshotsTable)
      .values({ ok: dbOk, latencyMs: Math.max(0, dbLatencyMs) })
      .catch((err) => logger.warn({ err }, "Failed to persist health snapshot"));
  }

  const status = dbOk ? "ok" : "degraded";
  res
    .status(dbOk ? 200 : 503)
    .json({
      status,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      db: { ok: dbOk, latencyMs: dbLatencyMs },
      timestamp: new Date().toISOString(),
    });
}

router.get("/healthz", healthHandler);
router.get("/health", healthHandler);

export default router;
