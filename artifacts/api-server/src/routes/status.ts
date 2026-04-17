import { Router, type IRouter } from "express";
import { db, healthSnapshotsTable, incidentsTable } from "@workspace/db";
import { sql, gte, desc, isNull, or } from "drizzle-orm";

const router: IRouter = Router();

const DAY_MS = 24 * 60 * 60 * 1000;

async function uptimePct(sinceMs: number): Promise<number> {
  const since = new Date(Date.now() - sinceMs);
  const [row] = await db
    .select({
      total: sql<string>`COUNT(*)`,
      okCount: sql<string>`COUNT(*) FILTER (WHERE ${healthSnapshotsTable.ok} = true)`,
    })
    .from(healthSnapshotsTable)
    .where(gte(healthSnapshotsTable.createdAt, since));

  const total = Number(row?.total ?? 0);
  const ok = Number(row?.okCount ?? 0);
  if (total === 0) return 100;
  return Math.round((ok / total) * 10000) / 100;
}

router.get("/status/summary", async (_req, res): Promise<void> => {
  try {
    const [up24h, up7d, up30d] = await Promise.all([
      uptimePct(DAY_MS),
      uptimePct(7 * DAY_MS),
      uptimePct(30 * DAY_MS),
    ]);

    // Active = no resolvedAt yet; recent resolved = up to 20 most recent
    const active = await db
      .select()
      .from(incidentsTable)
      .where(isNull(incidentsTable.resolvedAt))
      .orderBy(desc(incidentsTable.startedAt))
      .limit(20);

    const recent = await db
      .select()
      .from(incidentsTable)
      .where(or(isNull(incidentsTable.resolvedAt), gte(incidentsTable.startedAt, new Date(Date.now() - 30 * DAY_MS))))
      .orderBy(desc(incidentsTable.startedAt))
      .limit(20);

    const overallStatus = active.length === 0 ? "operational" : (
      active.some((i) => i.severity === "major" || i.severity === "critical") ? "major_outage" : "degraded"
    );

    res.json({
      status: overallStatus,
      uptime: { last24h: up24h, last7d: up7d, last30d: up30d },
      activeIncidents: active,
      recentIncidents: recent,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({
      status: "unknown",
      uptime: { last24h: 0, last7d: 0, last30d: 0 },
      activeIncidents: [],
      recentIncidents: [],
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }
});

export default router;
