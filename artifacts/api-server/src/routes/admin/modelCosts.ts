import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, modelCostsTable, plansTable } from "@workspace/db";
import { requireAdmin } from "../../middlewares/adminAuth";
import { warmModelCostsCache } from "../../lib/billing";

/** Remove `model` from every plan's modelsAllowed array */
async function removeModelFromPlans(model: string): Promise<void> {
  const plans = await db.select({ id: plansTable.id, modelsAllowed: plansTable.modelsAllowed }).from(plansTable);
  for (const plan of plans) {
    if (plan.modelsAllowed.includes(model)) {
      await db
        .update(plansTable)
        .set({ modelsAllowed: plan.modelsAllowed.filter((m) => m !== model) })
        .where(eq(plansTable.id, plan.id));
    }
  }
}

const router: IRouter = Router();

interface ModelCostFields {
  model?: string;
  inputPer1M?: number;
  outputPer1M?: number;
  perImage?: number | null;
  perSecond?: number | null;
  isActive?: boolean;
}

function parseBody(body: unknown): { error?: string; data?: ModelCostFields } {
  if (!body || typeof body !== "object") return { error: "Invalid body" };
  const b = body as Record<string, unknown>;
  const data: ModelCostFields = {};

  if ("model" in b) {
    if (typeof b.model !== "string" || b.model.trim().length === 0 || b.model.length > 100) {
      return { error: "model must be a non-empty string (max 100 chars)" };
    }
    data.model = b.model.trim();
  }

  if ("inputPer1M" in b) {
    if (typeof b.inputPer1M !== "number" || b.inputPer1M < 0) return { error: "inputPer1M must be a non-negative number" };
    data.inputPer1M = b.inputPer1M;
  }

  if ("outputPer1M" in b) {
    if (typeof b.outputPer1M !== "number" || b.outputPer1M < 0) return { error: "outputPer1M must be a non-negative number" };
    data.outputPer1M = b.outputPer1M;
  }

  if ("perImage" in b) {
    if (b.perImage !== null && (typeof b.perImage !== "number" || b.perImage < 0)) return { error: "perImage must be a non-negative number or null" };
    data.perImage = b.perImage as number | null;
  }

  if ("perSecond" in b) {
    if (b.perSecond !== null && (typeof b.perSecond !== "number" || b.perSecond < 0)) return { error: "perSecond must be a non-negative number or null" };
    data.perSecond = b.perSecond as number | null;
  }

  if ("isActive" in b) {
    if (typeof b.isActive !== "boolean") return { error: "isActive must be a boolean" };
    data.isActive = b.isActive;
  }

  return { data };
}

router.get("/admin/model-costs", requireAdmin, async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(modelCostsTable)
    .orderBy(modelCostsTable.model);
  res.json(rows);
});

router.post("/admin/model-costs", requireAdmin, async (req, res): Promise<void> => {
  const { error, data } = parseBody(req.body);
  if (error || !data) { res.status(400).json({ error: error ?? "Invalid body" }); return; }
  if (!data.model) { res.status(400).json({ error: "model is required" }); return; }
  if (data.inputPer1M == null) { res.status(400).json({ error: "inputPer1M is required" }); return; }
  if (data.outputPer1M == null) { res.status(400).json({ error: "outputPer1M is required" }); return; }

  const existing = await db
    .select({ model: modelCostsTable.model })
    .from(modelCostsTable)
    .where(eq(modelCostsTable.model, data.model))
    .limit(1);

  if (existing.length > 0) {
    res.status(409).json({ error: `Model "${data.model}" already exists. Use PUT to update.` });
    return;
  }

  const [row] = await db.insert(modelCostsTable).values({
    model: data.model,
    inputPer1M: data.inputPer1M,
    outputPer1M: data.outputPer1M,
    perImage: data.perImage ?? null,
    perSecond: data.perSecond ?? null,
    isActive: data.isActive ?? true,
  }).returning();

  await warmModelCostsCache();
  res.status(201).json(row);
});

router.put("/admin/model-costs/:model", requireAdmin, async (req, res): Promise<void> => {
  const model = decodeURIComponent(String(req.params.model));
  const { error, data } = parseBody(req.body);
  if (error || !data) { res.status(400).json({ error: error ?? "Invalid body" }); return; }

  const updateFields = Object.fromEntries(
    Object.entries(data).filter(([k]) => k !== "model")
  );

  if (Object.keys(updateFields).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  const [updated] = await db
    .update(modelCostsTable)
    .set(updateFields)
    .where(eq(modelCostsTable.model, model))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Model not found" });
    return;
  }

  // If model is being deactivated, remove it from all plan allowed-lists too
  const refreshTasks: Promise<unknown>[] = [warmModelCostsCache()];
  if (data.isActive === false) {
    refreshTasks.push(removeModelFromPlans(model));
  }
  await Promise.all(refreshTasks);
  res.json(updated);
});

router.delete("/admin/model-costs/:model", requireAdmin, async (req, res): Promise<void> => {
  const model = decodeURIComponent(String(req.params.model));

  const deleted = await db
    .delete(modelCostsTable)
    .where(eq(modelCostsTable.model, model))
    .returning({ model: modelCostsTable.model });

  if (deleted.length === 0) {
    res.status(404).json({ error: "Model not found" });
    return;
  }

  // Purge from all plan allowed-lists and refresh the billing cache
  await Promise.all([removeModelFromPlans(model), warmModelCostsCache()]);
  res.status(204).end();
});

export default router;
