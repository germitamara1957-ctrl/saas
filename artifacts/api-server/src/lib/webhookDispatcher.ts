import crypto from "crypto";
import { db, webhooksTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "./logger";
import { assertSafePublicUrl, SsrfBlockedError } from "./ssrfGuard";

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

  // Re-verify and follow redirects manually so each hop passes the SSRF
  // guard. This defeats both DNS rebinding (re-resolves at delivery) and
  // public-to-private redirect smuggling (e.g. a public 30x → 169.254.x.x).
  const MAX_REDIRECTS = 5;
  const ABORT_MS = 8000;
  let currentUrl = hook.url;
  let response: Response | undefined;
  const startedAt = Date.now();

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      try {
        await assertSafePublicUrl(currentUrl);
      } catch (err) {
        if (err instanceof SsrfBlockedError) {
          logger.warn({ webhookId: hook.id, url: currentUrl, hop, reason: err.message },
            "Webhook delivery blocked by SSRF guard");
          return { ok: false, error: `SSRF guard blocked delivery: ${err.message}` };
        }
        throw err;
      }

      const remaining = ABORT_MS - (Date.now() - startedAt);
      if (remaining <= 0) {
        return { ok: false, error: "Webhook delivery timed out" };
      }

      response = await fetch(currentUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Gateway-Signature": `sha256=${signature}`,
          "X-Gateway-Timestamp": timestamp,
          "X-Gateway-Event": payload.event,
        },
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(remaining),
      });

      // 30x — follow manually to re-validate the next hop
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) {
          return { ok: false, status: response.status, error: "Redirect without Location header" };
        }
        // Resolve relative redirects against the current URL
        let next: URL;
        try {
          next = new URL(location, currentUrl);
        } catch {
          return { ok: false, error: `Invalid redirect target: ${location}` };
        }
        currentUrl = next.toString();
        continue;
      }

      break;
    }

    if (!response) {
      return { ok: false, error: "Webhook delivery produced no response" };
    }

    if (response.status >= 300 && response.status < 400) {
      return { ok: false, status: response.status, error: `Too many redirects (>${MAX_REDIRECTS})` };
    }

    await db
      .update(webhooksTable)
      .set({ lastTriggeredAt: new Date() })
      .where(eq(webhooksTable.id, hook.id));

    if (!response.ok) {
      logger.warn({ webhookId: hook.id, url: hook.url, finalUrl: currentUrl, status: response.status },
        "Webhook endpoint returned non-2xx");
      return { ok: false, status: response.status };
    }

    return { ok: true, status: response.status };
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
