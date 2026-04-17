import { Router, type IRouter } from "express";
import { db, incidentsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

const router: IRouter = Router();

const VALID_STATUS = new Set(["investigating", "identified", "monitoring", "resolved"]);
const VALID_SEVERITY = new Set(["minor", "major", "critical", "maintenance"]);

router.get("/admin/incidents", async (_req, res): Promise<void> => {
  const rows = await db.select().from(incidentsTable).orderBy(desc(incidentsTable.startedAt)).limit(200);
  res.json({ incidents: rows });
});

router.post("/admin/incidents", async (req, res): Promise<void> => {
  const { titleEn, titleAr, bodyEn, bodyAr, status, severity, startedAt } = req.body ?? {};
  if (!titleEn || !titleAr) {
    res.status(400).json({ error: "titleEn and titleAr are required" });
    return;
  }
  const s = VALID_STATUS.has(status) ? status : "investigating";
  const sev = VALID_SEVERITY.has(severity) ? severity : "minor";
  const [row] = await db.insert(incidentsTable).values({
    titleEn, titleAr,
    bodyEn: bodyEn ?? "",
    bodyAr: bodyAr ?? "",
    status: s,
    severity: sev,
    startedAt: startedAt ? new Date(startedAt) : new Date(),
    resolvedAt: s === "resolved" ? new Date() : null,
  }).returning();
  res.status(201).json({ incident: row });
});

router.patch("/admin/incidents/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const { titleEn, titleAr, bodyEn, bodyAr, status, severity, resolvedAt } = req.body ?? {};

  const updates: Record<string, unknown> = {};
  if (titleEn !== undefined) updates.titleEn = titleEn;
  if (titleAr !== undefined) updates.titleAr = titleAr;
  if (bodyEn !== undefined) updates.bodyEn = bodyEn;
  if (bodyAr !== undefined) updates.bodyAr = bodyAr;
  if (status !== undefined && VALID_STATUS.has(status)) {
    updates.status = status;
    if (status === "resolved" && !resolvedAt) updates.resolvedAt = new Date();
    if (status !== "resolved" && resolvedAt === undefined) updates.resolvedAt = null;
  }
  if (severity !== undefined && VALID_SEVERITY.has(severity)) updates.severity = severity;
  if (resolvedAt !== undefined) updates.resolvedAt = resolvedAt ? new Date(resolvedAt) : null;

  const [row] = await db.update(incidentsTable).set(updates).where(eq(incidentsTable.id, id)).returning();
  if (!row) {
    res.status(404).json({ error: "Incident not found" });
    return;
  }
  res.json({ incident: row });
});

router.delete("/admin/incidents/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  await db.delete(incidentsTable).where(eq(incidentsTable.id, id));
  res.status(204).end();
});

export default router;
