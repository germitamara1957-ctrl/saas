import { Router, type IRouter } from "express";
import { eq, and, inArray, desc, sql } from "drizzle-orm";
import { db, apiKeysTable, usageLogsTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/portal/logs", async (req, res): Promise<void> => {
  const userId = Number(req.authUser!.sub);
  const page = Math.max(1, Number(req.query.page ?? 1));
  const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 50)));
  const offset = (page - 1) * limit;
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const model = typeof req.query.model === "string" ? req.query.model : undefined;

  const userKeys = await db
    .select({ id: apiKeysTable.id })
    .from(apiKeysTable)
    .where(eq(apiKeysTable.userId, userId));
  const keyIds = userKeys.map((k) => k.id);
  if (keyIds.length === 0) {
    res.json({ logs: [], page, limit, total: 0 });
    return;
  }

  const conds = [inArray(usageLogsTable.apiKeyId, keyIds)];
  if (status === "success" || status === "error") conds.push(eq(usageLogsTable.status, status));
  if (model) conds.push(eq(usageLogsTable.model, model));
  const where = and(...conds);

  const [{ total }] = await db
    .select({ total: sql<number>`COUNT(*)::int` })
    .from(usageLogsTable)
    .where(where);

  const rows = await db
    .select({
      id: usageLogsTable.id,
      apiKeyId: usageLogsTable.apiKeyId,
      model: usageLogsTable.model,
      endpoint: usageLogsTable.endpoint,
      statusCode: usageLogsTable.statusCode,
      status: usageLogsTable.status,
      inputTokens: usageLogsTable.inputTokens,
      outputTokens: usageLogsTable.outputTokens,
      costUsd: usageLogsTable.costUsd,
      requestId: usageLogsTable.requestId,
      errorMessage: usageLogsTable.errorMessage,
      createdAt: usageLogsTable.createdAt,
    })
    .from(usageLogsTable)
    .where(where)
    .orderBy(desc(usageLogsTable.id))
    .limit(limit)
    .offset(offset);

  res.json({ logs: rows, page, limit, total });
});

router.get("/portal/logs/:id", async (req, res): Promise<void> => {
  const userId = Number(req.authUser!.sub);
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid log id" });
    return;
  }
  const [row] = await db
    .select({
      log: usageLogsTable,
      keyUserId: apiKeysTable.userId,
      keyName: apiKeysTable.name,
    })
    .from(usageLogsTable)
    .leftJoin(apiKeysTable, eq(apiKeysTable.id, usageLogsTable.apiKeyId))
    .where(eq(usageLogsTable.id, id))
    .limit(1);
  if (!row || row.keyUserId !== userId) {
    res.status(404).json({ error: "Log not found" });
    return;
  }
  res.json({ ...row.log, keyName: row.keyName });
});

export default router;
