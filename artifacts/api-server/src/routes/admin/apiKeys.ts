import { Router, type IRouter } from "express";
import { eq, count } from "drizzle-orm";
import { db, apiKeysTable, usersTable } from "@workspace/db";
import {
  CreateApiKeyBody,
  UpdateApiKeyBody,
  GetApiKeyParams,
  UpdateApiKeyParams,
  RevokeApiKeyParams,
  ListApiKeysQueryParams,
} from "@workspace/api-zod";
import { requireAdmin } from "../../middlewares/adminAuth";
import { generateApiKey, encryptApiKey } from "../../lib/crypto";

const router: IRouter = Router();

router.get("/admin/api-keys", requireAdmin, async (req, res): Promise<void> => {
  const query = ListApiKeysQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const { userId, page = 1, limit = 20 } = query.data;
  const offset = (page - 1) * limit;

  const whereClause = userId ? eq(apiKeysTable.userId, userId) : undefined;

  const [items, totalResult] = await Promise.all([
    db
      .select({
        id: apiKeysTable.id,
        userId: apiKeysTable.userId,
        planId: apiKeysTable.planId,
        keyPrefix: apiKeysTable.keyPrefix,
        name: apiKeysTable.name,
        creditBalance: apiKeysTable.creditBalance,
        isActive: apiKeysTable.isActive,
        lastUsedAt: apiKeysTable.lastUsedAt,
        revokedAt: apiKeysTable.revokedAt,
        createdAt: apiKeysTable.createdAt,
        updatedAt: apiKeysTable.updatedAt,
      })
      .from(apiKeysTable)
      .where(whereClause)
      .orderBy(apiKeysTable.createdAt)
      .limit(limit)
      .offset(offset),
    db.select({ count: count() }).from(apiKeysTable).where(whereClause),
  ]);

  res.json({ items, total: totalResult[0]?.count ?? 0, page, limit });
});

router.post("/admin/api-keys", requireAdmin, async (req, res): Promise<void> => {
  const parsed = CreateApiKeyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [userExists] = await db
    .select({ id: usersTable.id, isActive: usersTable.isActive })
    .from(usersTable)
    .where(eq(usersTable.id, parsed.data.userId))
    .limit(1);
  if (!userExists) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  if (!userExists.isActive) {
    res.status(403).json({ error: "Cannot create API key for an inactive user" });
    return;
  }

  const { rawKey, keyHash, keyPrefix } = generateApiKey();
  const keyEncrypted = encryptApiKey(rawKey);

  const [apiKey] = await db
    .insert(apiKeysTable)
    .values({
      userId: parsed.data.userId,
      planId: parsed.data.planId,
      keyPrefix,
      keyHash,
      keyEncrypted,
      name: parsed.data.name ?? null,
      creditBalance: parsed.data.creditBalance ?? 0,
      isActive: true,
    })
    .returning();

  res.status(201).json({
    apiKey: {
      id: apiKey!.id,
      userId: apiKey!.userId,
      planId: apiKey!.planId,
      keyPrefix: apiKey!.keyPrefix,
      name: apiKey!.name,
      creditBalance: apiKey!.creditBalance,
      isActive: apiKey!.isActive,
      lastUsedAt: apiKey!.lastUsedAt,
      revokedAt: apiKey!.revokedAt,
      createdAt: apiKey!.createdAt,
      updatedAt: apiKey!.updatedAt,
    },
    rawKey,
  });
});

router.get("/admin/api-keys/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = GetApiKeyParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [apiKey] = await db
    .select({
      id: apiKeysTable.id,
      userId: apiKeysTable.userId,
      planId: apiKeysTable.planId,
      keyPrefix: apiKeysTable.keyPrefix,
      name: apiKeysTable.name,
      creditBalance: apiKeysTable.creditBalance,
      isActive: apiKeysTable.isActive,
      lastUsedAt: apiKeysTable.lastUsedAt,
      revokedAt: apiKeysTable.revokedAt,
      createdAt: apiKeysTable.createdAt,
      updatedAt: apiKeysTable.updatedAt,
    })
    .from(apiKeysTable)
    .where(eq(apiKeysTable.id, params.data.id));

  if (!apiKey) {
    res.status(404).json({ error: "API key not found" });
    return;
  }

  res.json(apiKey);
});

router.patch("/admin/api-keys/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = UpdateApiKeyParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateApiKeyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updates: Partial<typeof apiKeysTable.$inferInsert> = {};
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.isActive !== undefined) updates.isActive = parsed.data.isActive;
  if (parsed.data.planId !== undefined) updates.planId = parsed.data.planId;

  const [apiKey] = await db
    .update(apiKeysTable)
    .set(updates)
    .where(eq(apiKeysTable.id, params.data.id))
    .returning();

  if (!apiKey) {
    res.status(404).json({ error: "API key not found" });
    return;
  }

  res.json({
    id: apiKey.id,
    userId: apiKey.userId,
    planId: apiKey.planId,
    keyPrefix: apiKey.keyPrefix,
    name: apiKey.name,
    creditBalance: apiKey.creditBalance,
    isActive: apiKey.isActive,
    lastUsedAt: apiKey.lastUsedAt,
    revokedAt: apiKey.revokedAt,
    createdAt: apiKey.createdAt,
    updatedAt: apiKey.updatedAt,
  });
});

router.delete("/admin/api-keys/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = RevokeApiKeyParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [apiKey] = await db
    .update(apiKeysTable)
    .set({ isActive: false, revokedAt: new Date() })
    .where(eq(apiKeysTable.id, params.data.id))
    .returning();

  if (!apiKey) {
    res.status(404).json({ error: "API key not found" });
    return;
  }

  res.json({
    id: apiKey.id,
    userId: apiKey.userId,
    planId: apiKey.planId,
    keyPrefix: apiKey.keyPrefix,
    name: apiKey.name,
    creditBalance: apiKey.creditBalance,
    isActive: apiKey.isActive,
    lastUsedAt: apiKey.lastUsedAt,
    revokedAt: apiKey.revokedAt,
    createdAt: apiKey.createdAt,
    updatedAt: apiKey.updatedAt,
  });
});

export default router;
