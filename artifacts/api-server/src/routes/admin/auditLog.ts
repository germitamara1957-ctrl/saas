import { Router, type IRouter } from "express";
import { desc, count, gte, lte, and, or, ilike } from "drizzle-orm";
import { db, auditLogsTable } from "@workspace/db";
import { logger } from "../../lib/logger";

const router: IRouter = Router();

router.get("/admin/audit-log", async (req, res): Promise<void> => {
  const page = Math.max(1, parseInt(req.query.page as string || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string || "50", 10)));
  const offset = (page - 1) * limit;
  const search = (req.query.search as string | undefined)?.trim() || undefined;
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;

  const conditions = [];

  if (from) {
    const fromDate = new Date(from);
    if (!isNaN(fromDate.getTime())) {
      conditions.push(gte(auditLogsTable.createdAt, fromDate));
    }
  }
  if (to) {
    const toDate = new Date(to);
    if (!isNaN(toDate.getTime())) {
      toDate.setHours(23, 59, 59, 999);
      conditions.push(lte(auditLogsTable.createdAt, toDate));
    }
  }
  if (search) {
    conditions.push(
      or(
        ilike(auditLogsTable.action, `%${search}%`),
        ilike(auditLogsTable.actorEmail, `%${search}%`),
        ilike(auditLogsTable.targetEmail, `%${search}%`),
      )!,
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [items, totalResult] = await Promise.all([
    db
      .select()
      .from(auditLogsTable)
      .where(whereClause)
      .orderBy(desc(auditLogsTable.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ count: count() }).from(auditLogsTable).where(whereClause),
  ]);

  res.json({ items, total: Number(totalResult[0]?.count ?? 0), page, limit });
});

export async function logAuditEvent(opts: {
  action: string;
  actorId?: number;
  actorEmail?: string;
  targetId?: number;
  targetEmail?: string;
  details?: string;
  ip?: string;
}): Promise<void> {
  try {
    await db.insert(auditLogsTable).values({
      action: opts.action,
      actorId: opts.actorId ?? null,
      actorEmail: opts.actorEmail ?? null,
      targetId: opts.targetId ?? null,
      targetEmail: opts.targetEmail ?? null,
      details: opts.details ?? null,
      ip: opts.ip ?? null,
    });
  } catch (err) {
    logger.error({ err }, "[audit] Failed to log audit event");
  }
}

export default router;
