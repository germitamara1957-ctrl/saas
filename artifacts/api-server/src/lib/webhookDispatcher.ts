import crypto from "crypto";
import { db, webhooksTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "./logger";

export type WebhookEvent =
  | "usage.success"
  | "usage.error"
  | "usage.rejected"
  | "low_balance"
  | "video.completed"
  | "video.failed"
  | "spending.alert"
  | "spending.limit_reached";

export interface WebhookPayload {
  event: WebhookEvent;
  timestamp: string;
  data: Record<string, unknown>;
}

export interface WebhookRow {
  id: number;
  url: string;
  secret: string;
  events: string[];
}

/**
 * Sign a webhook payload using HMAC-SHA256.
 *
 * The signed string is `${timestamp}.${body}` (Stripe-style) so receivers can
 * reject replays by checking the timestamp window before verifying the digest.
 */
function sign(secret: string, timestamp: string, body: string): string {
  return crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

export async function sendSingleWebhook(
  hook: WebhookRow,
  payload: WebhookPayload,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = sign(hook.secret, timestamp, body);

  try {
    const res = await fetch(hook.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Gateway-Signature": `sha256=${signature}`,
        "X-Gateway-Timestamp": timestamp,
        "X-Gateway-Event": payload.event,
      },
      body,
      signal: AbortSignal.timeout(8000),
    });

    await db
      .update(webhooksTable)
      .set({ lastTriggeredAt: new Date() })
      .where(eq(webhooksTable.id, hook.id));

    if (!res.ok) {
      logger.warn({ webhookId: hook.id, url: hook.url, status: res.status }, "Webhook endpoint returned non-2xx");
      return { ok: false, status: res.status };
    }

    return { ok: true, status: res.status };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ webhookId: hook.id, url: hook.url, err: message }, "Webhook delivery failed");
    return { ok: false, error: message };
  }
}

export async function dispatchWebhooks(
  userId: number,
  event: WebhookEvent,
  data: Record<string, unknown>,
): Promise<void> {
  const hooks = await db
    .select()
    .from(webhooksTable)
    .where(
      and(
        eq(webhooksTable.userId, userId),
        eq(webhooksTable.isActive, true),
      ),
    );

  const payload: WebhookPayload = {
    event,
    timestamp: new Date().toISOString(),
    data,
  };

  const active = hooks.filter((h) => h.events.length === 0 || h.events.includes(event));

  await Promise.allSettled(
    active.map((h) => sendSingleWebhook(h, payload)),
  );
}
