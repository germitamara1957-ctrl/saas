import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, plansTable } from "@workspace/db";
import { CreatePlanBody, UpdatePlanBody, GetPlanParams, UpdatePlanParams, DeletePlanParams } from "@workspace/api-zod";
import { requireAdmin } from "../../middlewares/adminAuth";

const router: IRouter = Router();

router.get("/public/plans", async (req, res): Promise<void> => {
  const plans = await db
    .select()
    .from(plansTable)
    .orderBy(plansTable.priceUsd);
  res.json(plans);
});

router.get("/admin/plans", requireAdmin, async (req, res): Promise<void> => {
  const plans = await db.select().from(plansTable).orderBy(plansTable.id);
  res.json(plans);
});

router.post("/admin/plans", requireAdmin, async (req, res): Promise<void> => {
  const parsed = CreatePlanBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [plan] = await db
    .insert(plansTable)
    .values({
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      monthlyCredits: parsed.data.monthlyCredits,
      rpm: parsed.data.rpm,
      maxApiKeys: parsed.data.maxApiKeys ?? 3,
      maxWebhooks: parsed.data.maxWebhooks ?? 3,
      modelsAllowed: parsed.data.modelsAllowed,
      priceUsd: parsed.data.priceUsd,
      isActive: parsed.data.isActive ?? true,
    })
    .returning();

  res.status(201).json(plan);
});

router.get("/admin/plans/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = GetPlanParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [plan] = await db
    .select()
    .from(plansTable)
    .where(eq(plansTable.id, params.data.id));

  if (!plan) {
    res.status(404).json({ error: "Plan not found" });
    return;
  }

  res.json(plan);
});

router.patch("/admin/plans/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = UpdatePlanParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdatePlanBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updates: Partial<typeof plansTable.$inferInsert> = {};
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.description !== undefined) updates.description = parsed.data.description;
  if (parsed.data.monthlyCredits !== undefined) updates.monthlyCredits = parsed.data.monthlyCredits;
  if (parsed.data.rpm !== undefined) updates.rpm = parsed.data.rpm;
  if (parsed.data.maxApiKeys !== undefined) updates.maxApiKeys = parsed.data.maxApiKeys;
  if (parsed.data.maxWebhooks !== undefined) updates.maxWebhooks = parsed.data.maxWebhooks;
  if (parsed.data.modelsAllowed !== undefined) updates.modelsAllowed = parsed.data.modelsAllowed;
  if (parsed.data.priceUsd !== undefined) updates.priceUsd = parsed.data.priceUsd;
  if (parsed.data.isActive !== undefined) updates.isActive = parsed.data.isActive;

  const [plan] = await db
    .update(plansTable)
    .set(updates)
    .where(eq(plansTable.id, params.data.id))
    .returning();

  if (!plan) {
    res.status(404).json({ error: "Plan not found" });
    return;
  }

  res.json(plan);
});

router.delete("/admin/plans/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = DeletePlanParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [deleted] = await db
    .delete(plansTable)
    .where(eq(plansTable.id, params.data.id))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Plan not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
