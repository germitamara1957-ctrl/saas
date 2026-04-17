import { Router, type IRouter } from "express";
import { eq, and, gte, sql, count, sum, inArray, desc } from "drizzle-orm";
import { db, apiKeysTable, usageLogsTable } from "@workspace/db";
import { GetPortalUsageQueryParams } from "@workspace/api-zod";
import { z } from "zod";

const router: IRouter = Router();

const ExtraParams = z.object({
  model: z.string().trim().min(1).optional(),
});

router.get("/portal/usage", async (req, res): Promise<void> => {
  const userId = Number(req.authUser!.sub);

  const query = GetPortalUsageQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const extra = ExtraParams.safeParse(req.query);
  const modelFilter = extra.success ? extra.data.model : undefined;

  const { days = 30, page = 1, limit = 50 } = query.data;
  const offset = (page - 1) * limit;

  const since = new Date();
  since.setDate(since.getDate() - days);

  const userKeys = await db
    .select({ id: apiKeysTable.id })
    .from(apiKeysTable)
    .where(eq(apiKeysTable.userId, userId));

  const keyIds = userKeys.map((k) => k.id);

  if (keyIds.length === 0) {
    res.json({ dailyUsage: [], byModel: [], recentLogs: [], total: 0, page, limit, modelFilter: modelFilter ?? null });
    return;
  }

  const baseFilter = and(
    inArray(usageLogsTable.apiKeyId, keyIds),
    gte(usageLogsTable.createdAt, since),
  );

  // Apply model filter to recentLogs and totals, but NOT to byModel (always show all models)
  const logsFilter = modelFilter
    ? and(baseFilter, eq(usageLogsTable.model, modelFilter))
    : baseFilter;

  const [recentLogs, totalResult] = await Promise.all([
    db
      .select()
      .from(usageLogsTable)
      .where(logsFilter)
      .orderBy(desc(usageLogsTable.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: count() })
      .from(usageLogsTable)
      .where(logsFilter),
  ]);

  const [dailyData, byModelData] = await Promise.all([
    db
      .select({
        date: sql<string>`DATE(${usageLogsTable.createdAt})`.as("date"),
        totalRequests: count(),
        totalTokens: sum(usageLogsTable.totalTokens),
        totalCostUsd: sum(usageLogsTable.costUsd),
      })
      .from(usageLogsTable)
      .where(logsFilter)
      .groupBy(sql`DATE(${usageLogsTable.createdAt})`)
      .orderBy(sql`DATE(${usageLogsTable.createdAt})`),

    db
      .select({
        model: usageLogsTable.model,
        totalRequests: count(),
        totalTokens: sum(usageLogsTable.totalTokens),
        totalCostUsd: sum(usageLogsTable.costUsd),
      })
      .from(usageLogsTable)
      .where(baseFilter)
      .groupBy(usageLogsTable.model)
      .orderBy(sql`count(*) DESC`),
  ]);

  const dailyUsage = dailyData.map((d) => ({
    date: d.date,
    totalRequests: Number(d.totalRequests),
    totalTokens: Number(d.totalTokens ?? 0),
    totalCostUsd: Number(d.totalCostUsd ?? 0),
  }));

  const byModel = byModelData.map((m) => ({
    model: m.model,
    totalRequests: Number(m.totalRequests),
    totalTokens: Number(m.totalTokens ?? 0),
    totalCostUsd: Number(m.totalCostUsd ?? 0),
  }));

  res.json({
    dailyUsage,
    byModel,
    recentLogs,
    total: Number(totalResult[0]?.count ?? 0),
    page,
    limit,
    modelFilter: modelFilter ?? null,
  });
});

export default router;
