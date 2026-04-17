import { Router, type IRouter } from "express";
import { db, promoCodesTable, promoCodeUsesTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

const router: IRouter = Router();

router.get("/admin/promo-codes", async (req, res): Promise<void> => {
  const codes = await db
    .select()
    .from(promoCodesTable)
    .orderBy(desc(promoCodesTable.createdAt));
  res.json(codes);
});

router.post("/admin/promo-codes", async (req, res): Promise<void> => {
  const { code, creditsAmount, maxUses, expiresAt, isActive, note } = req.body as {
    code?: unknown;
    creditsAmount?: unknown;
    maxUses?: unknown;
    expiresAt?: unknown;
    isActive?: unknown;
    note?: unknown;
  };

  if (typeof code !== "string" || code.trim().length < 2) {
    res.status(400).json({ error: "code must be at least 2 characters" });
    return;
  }
  if (typeof creditsAmount !== "number" || creditsAmount <= 0) {
    res.status(400).json({ error: "creditsAmount must be a positive number" });
    return;
  }
  if (typeof maxUses !== "number" || !Number.isInteger(maxUses) || maxUses < 1) {
    res.status(400).json({ error: "maxUses must be a positive integer" });
    return;
  }

  const normalizedCode = code.trim().toUpperCase();
  const existing = await db.select({ id: promoCodesTable.id }).from(promoCodesTable).where(eq(promoCodesTable.code, normalizedCode)).limit(1);
  if (existing.length > 0) {
    res.status(409).json({ error: "Code already exists" });
    return;
  }

  const [created] = await db.insert(promoCodesTable).values({
    code: normalizedCode,
    creditsAmount,
    maxUses,
    expiresAt: expiresAt && typeof expiresAt === "string" ? new Date(expiresAt) : null,
    isActive: isActive === false ? false : true,
    note: note && typeof note === "string" ? note.trim() || null : null,
  }).returning();

  res.status(201).json(created);
});

router.patch("/admin/promo-codes/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const body = req.body as Record<string, unknown>;
  const updateValues: Record<string, unknown> = {};

  if (body.code !== undefined) {
    if (typeof body.code !== "string" || body.code.trim().length < 2) {
      res.status(400).json({ error: "Invalid code" }); return;
    }
    updateValues.code = body.code.trim().toUpperCase();
  }
  if (body.creditsAmount !== undefined) {
    if (typeof body.creditsAmount !== "number" || body.creditsAmount <= 0) {
      res.status(400).json({ error: "Invalid creditsAmount" }); return;
    }
    updateValues.creditsAmount = body.creditsAmount;
  }
  if (body.maxUses !== undefined) {
    if (typeof body.maxUses !== "number" || !Number.isInteger(body.maxUses) || body.maxUses < 1) {
      res.status(400).json({ error: "Invalid maxUses" }); return;
    }
    updateValues.maxUses = body.maxUses;
  }
  if (body.isActive !== undefined) updateValues.isActive = !!body.isActive;
  if (body.note !== undefined) updateValues.note = body.note ? String(body.note).trim() || null : null;
  if ("expiresAt" in body) {
    updateValues.expiresAt = body.expiresAt && typeof body.expiresAt === "string" ? new Date(body.expiresAt) : null;
  }

  if (Object.keys(updateValues).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  const [updated] = await db.update(promoCodesTable).set(updateValues).where(eq(promoCodesTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(updated);
});

router.delete("/admin/promo-codes/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [deleted] = await db.delete(promoCodesTable).where(eq(promoCodesTable.id, id)).returning();
  if (!deleted) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ success: true });
});

export default router;
