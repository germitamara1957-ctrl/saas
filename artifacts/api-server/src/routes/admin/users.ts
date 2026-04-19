import { Router, type IRouter } from "express";
import { eq, ilike, or, count, sql } from "drizzle-orm";
import { db, usersTable, apiKeysTable, plansTable } from "@workspace/db";
import {
  CreateUserBody,
  UpdateUserBody,
  GetUserParams,
  UpdateUserParams,
  DeleteUserParams,
  ListUsersQueryParams,
} from "@workspace/api-zod";
import { requireAdmin } from "../../middlewares/adminAuth";
import { hashPassword } from "../../lib/crypto";
import { logAuditEvent } from "./auditLog";
import { recordReferralEarning } from "../../lib/referrals";
import { logger } from "../../lib/logger";

const router: IRouter = Router();

function getIp(req: import("express").Request): string {
  return req.ip ?? "unknown";
}

router.get("/admin/users", requireAdmin, async (req, res): Promise<void> => {
  const query = ListUsersQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const { search, page = 1, limit = 20 } = query.data;
  const offset = (page - 1) * limit;

  const whereClause = search
    ? or(ilike(usersTable.email, `%${search}%`), ilike(usersTable.name, `%${search}%`))
    : undefined;

  const [items, totalResult] = await Promise.all([
    db
      .select({
        id: usersTable.id,
        email: usersTable.email,
        name: usersTable.name,
        role: usersTable.role,
        isActive: usersTable.isActive,
        emailVerified: usersTable.emailVerified,
        creditBalance: usersTable.creditBalance,
        topupCreditBalance: usersTable.topupCreditBalance,
        createdAt: usersTable.createdAt,
        updatedAt: usersTable.updatedAt,
      })
      .from(usersTable)
      .where(whereClause)
      .orderBy(usersTable.createdAt)
      .limit(limit)
      .offset(offset),
    db
      .select({ count: count() })
      .from(usersTable)
      .where(whereClause),
  ]);

  res.json({ items, total: totalResult[0]?.count ?? 0, page, limit });
});

router.post("/admin/users", requireAdmin, async (req, res): Promise<void> => {
  const actor = req.authUser!;
  const parsed = CreateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const existing = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, parsed.data.email))
    .limit(1);

  if (existing.length > 0) {
    res.status(409).json({ error: "Email already in use" });
    return;
  }

  const passwordHash = await hashPassword(parsed.data.password);

  const [user] = await db
    .insert(usersTable)
    .values({
      email: parsed.data.email,
      passwordHash,
      name: parsed.data.name,
      role: parsed.data.role ?? "developer",
      isActive: true,
      emailVerified: true,
    })
    .returning();

  await logAuditEvent({
    action: "user.created",
    actorId: parseInt(actor.sub, 10),
    actorEmail: actor.email,
    targetId: user!.id,
    targetEmail: user!.email,
    details: `Role: ${user!.role}`,
    ip: getIp(req),
  });

  res.status(201).json({
    id: user!.id,
    email: user!.email,
    name: user!.name,
    role: user!.role,
    isActive: user!.isActive,
    createdAt: user!.createdAt,
    updatedAt: user!.updatedAt,
  });
});

router.get("/admin/users/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = GetUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [user] = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      name: usersTable.name,
      role: usersTable.role,
      isActive: usersTable.isActive,
      emailVerified: usersTable.emailVerified,
      creditBalance: usersTable.creditBalance,
      topupCreditBalance: usersTable.topupCreditBalance,
      currentPlanId: usersTable.currentPlanId,
      currentPeriodStartedAt: usersTable.currentPeriodStartedAt,
      currentPeriodEnd: usersTable.currentPeriodEnd,
      createdAt: usersTable.createdAt,
      updatedAt: usersTable.updatedAt,
    })
    .from(usersTable)
    .where(eq(usersTable.id, params.data.id));

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json(user);
});

router.patch("/admin/users/:id", requireAdmin, async (req, res): Promise<void> => {
  const actor = req.authUser!;
  const params = UpdateUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updates: Partial<typeof usersTable.$inferInsert> = {};
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.isActive !== undefined) updates.isActive = parsed.data.isActive;
  if (parsed.data.role !== undefined) updates.role = parsed.data.role;

  if (parsed.data.email !== undefined) {
    const emailConflict = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, parsed.data.email))
      .limit(1);
    if (emailConflict.length > 0 && emailConflict[0]!.id !== params.data.id) {
      res.status(409).json({ error: "Email already in use by another account" });
      return;
    }
    updates.email = parsed.data.email;
  }

  const [user] = await db
    .update(usersTable)
    .set(updates)
    .where(eq(usersTable.id, params.data.id))
    .returning();

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const changedFields = Object.keys(parsed.data).join(", ");
  const action = parsed.data.isActive === false ? "user.deactivated" : "user.updated";

  await logAuditEvent({
    action,
    actorId: parseInt(actor.sub, 10),
    actorEmail: actor.email,
    targetId: user.id,
    targetEmail: user.email,
    details: `Changed: ${changedFields}`,
    ip: getIp(req),
  });

  res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    isActive: user.isActive,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  });
});

router.delete("/admin/users/:id", requireAdmin, async (req, res): Promise<void> => {
  const actor = req.authUser!;
  const params = DeleteUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [deleted] = await db
    .delete(usersTable)
    .where(eq(usersTable.id, params.data.id))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  await logAuditEvent({
    action: "user.deleted",
    actorId: parseInt(actor.sub, 10),
    actorEmail: actor.email,
    targetId: deleted.id,
    targetEmail: deleted.email,
    ip: getIp(req),
  });

  res.sendStatus(204);
});

router.post("/admin/users/:id/credits", requireAdmin, async (req, res): Promise<void> => {
  const actor = req.authUser!;
  const userId = parseInt(String(req.params.id), 10);
  if (isNaN(userId) || userId <= 0) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }

  const { amount } = req.body as { amount?: unknown };
  const parsed = Number(amount);
  if (amount === undefined || amount === null || isNaN(parsed) || parsed === 0) {
    res.status(400).json({ error: "amount must be a non-zero number (positive to add, negative to deduct)" });
    return;
  }

  // This endpoint manages TOP-UP credit (works on all models, never expires).
  // Subscription credit is granted only via plan upgrade.
  if (parsed < 0) {
    const [current] = await db
      .select({ topupCreditBalance: usersTable.topupCreditBalance })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    if (!current) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const currentBalance = Number(current.topupCreditBalance);
    if (currentBalance + parsed < 0) {
      res.status(400).json({
        error: `Cannot deduct $${Math.abs(parsed).toFixed(4)} — top-up balance is only $${currentBalance.toFixed(4)}`,
      });
      return;
    }
  }

  const [user] = await db
    .update(usersTable)
    .set({ topupCreditBalance: sql`topup_credit_balance + ${parsed}` })
    .where(eq(usersTable.id, userId))
    .returning({
      id: usersTable.id,
      email: usersTable.email,
      creditBalance: usersTable.creditBalance,
      topupCreditBalance: usersTable.topupCreditBalance,
    });

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const isDeduction = parsed < 0;
  await logAuditEvent({
    action: isDeduction ? "user.topup.deducted" : "user.topup.added",
    actorId: parseInt(actor.sub, 10),
    actorEmail: actor.email,
    targetId: user.id,
    targetEmail: user.email,
    details: isDeduction
      ? `Deducted $${Math.abs(parsed).toFixed(4)} top-up credit`
      : `Added $${parsed.toFixed(4)} top-up credit`,
    ip: getIp(req),
  });

  res.json({
    id: user.id,
    email: user.email,
    creditBalance: user.creditBalance,
    topupCreditBalance: user.topupCreditBalance,
  });
});

router.post("/admin/users/:id/upgrade-plan", requireAdmin, async (req, res): Promise<void> => {
  const actor = req.authUser!;
  const userId = parseInt(String(req.params.id), 10);
  if (isNaN(userId) || userId <= 0) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }

  const { planId, addCredits } = req.body as { planId?: unknown; addCredits?: unknown };
  const planIdNum = parseInt(String(planId), 10);
  if (isNaN(planIdNum) || planIdNum <= 0) {
    res.status(400).json({ error: "planId must be a positive integer" });
    return;
  }

  const [plan] = await db
    .select()
    .from(plansTable)
    .where(eq(plansTable.id, planIdNum))
    .limit(1);

  if (!plan) {
    res.status(404).json({ error: "Plan not found" });
    return;
  }

  const creditsToAdd = (addCredits === false || addCredits === 0) ? 0 : plan.monthlyCredits;

  const activeKeys = await db
    .select({ id: apiKeysTable.id })
    .from(apiKeysTable)
    .where(eq(apiKeysTable.userId, userId));

  const user = await db.transaction(async (tx) => {
    if (activeKeys.length > 0) {
      await Promise.all(
        activeKeys.map((k) =>
          tx.update(apiKeysTable).set({ planId: planIdNum }).where(eq(apiKeysTable.id, k.id))
        )
      );
    }

    const nowTs = new Date();
    const periodEnd = new Date(nowTs.getTime() + 30 * 24 * 60 * 60 * 1000);
    const [updated] = await tx
      .update(usersTable)
      .set({
        currentPlanId: planIdNum,
        // Subscription credit ACCUMULATES on plan change so unused credit from
        // a prior plan (e.g. Pro) is preserved when upgrading (e.g. to Enterprise).
        // Set creditsToAdd=0 from admin UI ("addCredits=false") to avoid double-grant.
        creditBalance: sql`${usersTable.creditBalance} + ${creditsToAdd}`,
        // Reset the subscription window to a fresh 30-day cycle.
        currentPeriodStartedAt: nowTs,
        currentPeriodEnd: periodEnd,
      })
      .where(eq(usersTable.id, userId))
      .returning({
        id: usersTable.id,
        email: usersTable.email,
        creditBalance: usersTable.creditBalance,
        topupCreditBalance: usersTable.topupCreditBalance,
      });

    return updated ?? null;
  });

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  await logAuditEvent({
    action: "user.plan.upgraded",
    actorId: parseInt(actor.sub, 10),
    actorEmail: actor.email,
    targetId: user.id,
    targetEmail: user.email,
    details: `Upgraded to plan "${plan.name}" (id ${planIdNum}); added $${creditsToAdd} credits`,
    ip: getIp(req),
  });

  // Referral commission — basis is the *plan's USD price* (revenue), NOT the credit value granted.
  // Idempotency key combines user+plan+period-start so re-upgrading in a new billing period
  // creates a new earning, but a duplicate click in the same second is dedup'd by UNIQUE(source_type, source_id).
  if (plan.priceUsd > 0) {
    try {
      const periodStartTs = (await db.select({ ts: usersTable.currentPeriodStartedAt })
        .from(usersTable).where(eq(usersTable.id, user.id)).limit(1))[0]?.ts;
      const sourceId = `${user.id}:${planIdNum}:${periodStartTs ? periodStartTs.getTime() : Date.now()}`;
      const result = await recordReferralEarning({
        referredUserId: user.id,
        sourceType: "plan",
        sourceId,
        basisAmountUsd: plan.priceUsd,
      });
      if (result) {
        logger.info({ userId: user.id, referrerId: result.referrerId, commissionUsd: result.commissionUsd, planId: planIdNum }, "referral.commission.recorded.plan");
      }
    } catch (err) {
      logger.error({ err, userId: user.id, planId: planIdNum }, "referral.commission.failed.plan");
    }
  }

  res.json({
    id: user.id,
    email: user.email,
    creditBalance: user.creditBalance,
    topupCreditBalance: user.topupCreditBalance,
    planId: planIdNum,
    planName: plan.name,
    creditsAdded: creditsToAdd,
    keysUpdated: activeKeys.length,
  });
});

// ── Subscription period management ───────────────────────────────────────────
router.post("/admin/users/:id/subscription/extend", requireAdmin, async (req, res): Promise<void> => {
  const actor = req.authUser!;
  const userId = parseInt(String(req.params.id), 10);
  if (isNaN(userId) || userId <= 0) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }
  const daysRaw = (req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>)["days"] : undefined);
  const days = typeof daysRaw === "number" && Number.isFinite(daysRaw) && daysRaw > 0 && daysRaw <= 3650 ? daysRaw : 30;

  const [existing] = await db
    .select({ id: usersTable.id, email: usersTable.email, currentPeriodEnd: usersTable.currentPeriodEnd })
    .from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!existing) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  // Extend from whichever is later: now or current period end (don't credit lapsed days).
  const base = existing.currentPeriodEnd && existing.currentPeriodEnd.getTime() > Date.now()
    ? existing.currentPeriodEnd
    : new Date();
  const newEnd = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);

  const updateSet: Record<string, unknown> = { currentPeriodEnd: newEnd };
  if (!existing.currentPeriodEnd) updateSet["currentPeriodStartedAt"] = new Date();
  const [updated] = await db.update(usersTable)
    .set(updateSet)
    .where(eq(usersTable.id, userId))
    .returning({ id: usersTable.id, email: usersTable.email, currentPeriodEnd: usersTable.currentPeriodEnd, currentPeriodStartedAt: usersTable.currentPeriodStartedAt });

  await logAuditEvent({
    action: "user.subscription.extended",
    actorId: parseInt(actor.sub, 10),
    actorEmail: actor.email,
    targetId: userId,
    targetEmail: updated?.email,
    details: `Extended subscription by ${days} day(s); new period_end=${newEnd.toISOString()}`,
    ip: getIp(req),
  });

  res.json({
    id: updated!.id,
    currentPeriodEnd: updated!.currentPeriodEnd,
    currentPeriodStartedAt: updated!.currentPeriodStartedAt,
    daysAdded: days,
  });
});

router.post("/admin/users/:id/subscription/end", requireAdmin, async (req, res): Promise<void> => {
  const actor = req.authUser!;
  const userId = parseInt(String(req.params.id), 10);
  if (isNaN(userId) || userId <= 0) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }
  const now = new Date();
  const [updated] = await db.update(usersTable)
    .set({ currentPeriodEnd: now })
    .where(eq(usersTable.id, userId))
    .returning({ id: usersTable.id, email: usersTable.email, currentPeriodEnd: usersTable.currentPeriodEnd });

  if (!updated) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  await logAuditEvent({
    action: "user.subscription.ended",
    actorId: parseInt(actor.sub, 10),
    actorEmail: actor.email,
    targetId: userId,
    targetEmail: updated.email,
    details: "Subscription ended immediately by admin",
    ip: getIp(req),
  });

  res.json({ id: updated.id, currentPeriodEnd: updated.currentPeriodEnd });
});

router.post("/admin/users/:id/verify-email", requireAdmin, async (req, res): Promise<void> => {
  const actor = req.authUser!;
  const userId = parseInt(String(req.params.id), 10);
  if (isNaN(userId) || userId <= 0) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }

  const [user] = await db
    .update(usersTable)
    .set({ emailVerified: true })
    .where(eq(usersTable.id, userId))
    .returning({ id: usersTable.id, email: usersTable.email });

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  await logAuditEvent({
    action: "user.email.verified",
    actorId: parseInt(actor.sub, 10),
    actorEmail: actor.email,
    targetId: user.id,
    targetEmail: user.email,
    details: "Email manually verified by admin",
    ip: getIp(req),
  });

  res.json({ id: user.id, email: user.email, emailVerified: true });
});

export default router;
