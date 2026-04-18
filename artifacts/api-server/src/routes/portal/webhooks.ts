import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import crypto from "crypto";
import { db, webhooksTable, usersTable, plansTable } from "@workspace/db";
import { sendSingleWebhook, type WebhookPayload } from "../../lib/webhookDispatcher";
import { assertSafePublicUrl, SsrfBlockedError } from "../../lib/ssrfGuard";

const router: IRouter = Router();

router.get("/portal/webhooks", async (req, res): Promise<void> => {
  const userId = Number(req.authUser!.sub);
  const hooks = await db
    .select()
    .from(webhooksTable)
    .where(eq(webhooksTable.userId, userId))
    .orderBy(webhooksTable.createdAt);
  res.json(hooks);
});

router.post("/portal/webhooks", async (req, res): Promise<void> => {
  const userId = Number(req.authUser!.sub);
  const { name, url, events } = req.body as { name?: unknown; url?: unknown; events?: unknown };

  if (!name || typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  if (!url || typeof url !== "string") {
    res.status(400).json({ error: "url is required" });
    return;
  }
  try {
    await assertSafePublicUrl(url);
  } catch (err) {
    if (err instanceof SsrfBlockedError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }

  const eventsArr: string[] = Array.isArray(events) ? events.filter((e): e is string => typeof e === "string") : [];

  // Soft limit: enforce per-plan maxWebhooks
  const [user] = await db
    .select({ planId: usersTable.currentPlanId })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (user?.planId) {
    const [plan] = await db
      .select({ maxWebhooks: plansTable.maxWebhooks, name: plansTable.name })
      .from(plansTable)
      .where(eq(plansTable.id, user.planId))
      .limit(1);
    if (plan) {
      const existing = await db
        .select({ id: webhooksTable.id })
        .from(webhooksTable)
        .where(eq(webhooksTable.userId, userId));
      if (existing.length >= plan.maxWebhooks) {
        res.status(403).json({
          error: `Plan "${plan.name}" allows up to ${plan.maxWebhooks} webhooks. Upgrade your plan to add more.`,
        });
        return;
      }
    }
  }

  const secret = crypto.randomBytes(24).toString("hex");

  const [hook] = await db
    .insert(webhooksTable)
    .values({ userId, name: name.trim(), url, events: eventsArr, secret, isActive: true })
    .returning();

  res.status(201).json(hook);
});

router.put("/portal/webhooks/:id", async (req, res): Promise<void> => {
  const userId = Number(req.authUser!.sub);
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }

  const { name, url, events, isActive } = req.body as {
    name?: unknown; url?: unknown; events?: unknown; isActive?: unknown;
  };

  const updates: Partial<{ name: string; url: string; events: string[]; isActive: boolean; updatedAt: Date }> = {
    updatedAt: new Date(),
  };

  if (name !== undefined) {
    if (typeof name !== "string" || !name.trim()) { res.status(400).json({ error: "name must be a non-empty string" }); return; }
    updates.name = name.trim();
  }
  if (url !== undefined) {
    if (typeof url !== "string") { res.status(400).json({ error: "url must be a string" }); return; }
    try {
      await assertSafePublicUrl(url);
    } catch (err) {
      if (err instanceof SsrfBlockedError) { res.status(400).json({ error: err.message }); return; }
      throw err;
    }
    updates.url = url;
  }
  if (events !== undefined) {
    if (!Array.isArray(events)) { res.status(400).json({ error: "events must be an array" }); return; }
    updates.events = events.filter((e): e is string => typeof e === "string");
  }
  if (isActive !== undefined) {
    updates.isActive = Boolean(isActive);
  }

  const [hook] = await db
    .update(webhooksTable)
    .set(updates)
    .where(and(eq(webhooksTable.id, id), eq(webhooksTable.userId, userId)))
    .returning();

  if (!hook) { res.status(404).json({ error: "Webhook not found" }); return; }
  res.json(hook);
});

router.delete("/portal/webhooks/:id", async (req, res): Promise<void> => {
  const userId = Number(req.authUser!.sub);
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }

  const [deleted] = await db
    .delete(webhooksTable)
    .where(and(eq(webhooksTable.id, id), eq(webhooksTable.userId, userId)))
    .returning();

  if (!deleted) { res.status(404).json({ error: "Webhook not found" }); return; }
  res.json({ ok: true });
});

router.post("/portal/webhooks/:id/rotate-secret", async (req, res): Promise<void> => {
  const userId = Number(req.authUser!.sub);
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }

  const newSecret = crypto.randomBytes(24).toString("hex");

  const [hook] = await db
    .update(webhooksTable)
    .set({ secret: newSecret, updatedAt: new Date() })
    .where(and(eq(webhooksTable.id, id), eq(webhooksTable.userId, userId)))
    .returning();

  if (!hook) { res.status(404).json({ error: "Webhook not found" }); return; }
  res.json(hook);
});

router.post("/portal/webhooks/:id/test", async (req, res): Promise<void> => {
  const userId = Number(req.authUser!.sub);
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }

  const [hook] = await db
    .select()
    .from(webhooksTable)
    .where(and(eq(webhooksTable.id, id), eq(webhooksTable.userId, userId)));

  if (!hook) { res.status(404).json({ error: "Webhook not found" }); return; }

  const payload: WebhookPayload = {
    event: "usage.success",
    timestamp: new Date().toISOString(),
    data: {
      model: "gemini-2.5-flash",
      requestId: `test-${Date.now()}`,
      inputTokens: 100,
      outputTokens: 200,
      costUsd: 0.000042,
      note: "This is a test event from the gateway.",
    },
  };

  const result = await sendSingleWebhook(
    { id: hook.id, url: hook.url, secret: hook.secret, events: hook.events },
    payload,
  );

  if (!result.ok) {
    res.status(502).json({
      ok: false,
      message: "Test webhook delivery failed",
      error: result.error ?? `Endpoint returned HTTP ${result.status}`,
    });
    return;
  }

  res.json({ ok: true, message: "Test webhook delivered successfully", status: result.status });
});

export default router;
