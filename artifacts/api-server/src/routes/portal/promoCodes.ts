import { Router, type IRouter } from "express";
import { db, promoCodesTable, promoCodeUsesTable, usersTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";

const router: IRouter = Router();

router.post("/portal/promo-codes/redeem", async (req, res): Promise<void> => {
  // Auth middleware (requireAuth) sets req.authUser, not req.user.
  const userId = Number(req.authUser!.sub);

  const rawCode = (req.body as { code?: unknown }).code;
  if (typeof rawCode !== "string" || rawCode.trim().length === 0) {
    res.status(400).json({ error: "invalid_code" });
    return;
  }

  const code = rawCode.trim().toUpperCase();

  const [promoCode] = await db
    .select()
    .from(promoCodesTable)
    .where(eq(promoCodesTable.code, code))
    .limit(1);

  if (!promoCode) {
    res.status(404).json({ error: "invalid_code" });
    return;
  }

  if (!promoCode.isActive) {
    res.status(400).json({ error: "code_inactive" });
    return;
  }

  if (promoCode.expiresAt && new Date(promoCode.expiresAt) < new Date()) {
    res.status(400).json({ error: "code_expired" });
    return;
  }

  if (promoCode.usedCount >= promoCode.maxUses) {
    res.status(400).json({ error: "code_exhausted" });
    return;
  }

  const existingUse = await db
    .select({ id: promoCodeUsesTable.id })
    .from(promoCodeUsesTable)
    .where(
      and(
        eq(promoCodeUsesTable.promoCodeId, promoCode.id),
        eq(promoCodeUsesTable.userId, userId)
      )
    )
    .limit(1);

  if (existingUse.length > 0) {
    res.status(400).json({ error: "already_used" });
    return;
  }

  await db.transaction(async (tx) => {
    await tx.insert(promoCodeUsesTable).values({
      promoCodeId: promoCode.id,
      userId,
    });

    await tx
      .update(promoCodesTable)
      .set({ usedCount: sql`${promoCodesTable.usedCount} + 1` })
      .where(eq(promoCodesTable.id, promoCode.id));

    await tx
      .update(usersTable)
      .set({ creditBalance: sql`${usersTable.creditBalance} + ${promoCode.creditsAmount}` })
      .where(eq(usersTable.id, userId));
  });

  const [updatedUser] = await db
    .select({ creditBalance: usersTable.creditBalance })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  res.json({
    success: true,
    creditsAdded: promoCode.creditsAmount,
    newBalance: updatedUser?.creditBalance ?? 0,
  });
});

export default router;
