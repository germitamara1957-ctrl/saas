import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger";

/**
 * Idempotency middleware for billing-sensitive endpoints.
 *
 * Clients pass `Idempotency-Key: <unique-string>` and we cache the response
 * for 24h keyed by (apiKeyId, idempotencyKey). Replays return the cached
 * response immediately — protecting against double-charging on network retries.
 *
 * Storage: a small Postgres table `idempotency_keys` (created lazily on first
 * use) so we don't introduce a Redis hard-dependency. Rows are pruned on read.
 *
 * The middleware is opt-in per route — mount it on `/v1/chat/completions`,
 * `/v1/responses`, `/v1/generate`, and `/v1/video` to cover paid endpoints.
 */

const TTL_HOURS = 24;
const MAX_KEY_LENGTH = 255;
let tableEnsured = false;

async function ensureTable(): Promise<void> {
  if (tableEnsured) return;
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS idempotency_keys (
      api_key_id  INTEGER     NOT NULL,
      key         TEXT        NOT NULL,
      status      INTEGER     NOT NULL,
      body        TEXT        NOT NULL,
      content_type TEXT       NOT NULL DEFAULT 'application/json',
      request_hash TEXT       NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at  TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (api_key_id, key)
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idempotency_keys_expires_idx
      ON idempotency_keys (expires_at)
  `);
  tableEnsured = true;
}

function hashRequest(body: unknown, url: string, method: string): string {
  const payload = JSON.stringify({ body, url, method });
  return crypto.createHash("sha256").update(payload).digest("hex");
}

export async function idempotency(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const rawKey = req.header("idempotency-key");
  if (!rawKey) {
    next();
    return;
  }
  const idempotencyKey = rawKey.trim();
  if (!idempotencyKey || idempotencyKey.length > MAX_KEY_LENGTH) {
    res.status(400).json({ error: `Idempotency-Key must be 1..${MAX_KEY_LENGTH} characters` });
    return;
  }

  // Skip streaming responses — chunked SSE / res.write payloads cannot be safely cached
  // and replaying them would either return an empty/partial body or buffer unbounded memory.
  // Clients may still pass Idempotency-Key on streaming requests; we just don't dedupe them.
  const accept = req.header("accept") ?? "";
  const bodyStream = (req.body && typeof req.body === "object" && "stream" in req.body)
    ? Boolean((req.body as { stream?: unknown }).stream)
    : false;
  if (accept.includes("text/event-stream") || bodyStream) {
    next();
    return;
  }

  const apiKey = req.apiKey;
  if (!apiKey) {
    // Idempotency is only available on authenticated /v1/* routes.
    next();
    return;
  }

  try {
    await ensureTable();
  } catch (err) {
    logger.warn({ err }, "Failed to ensure idempotency_keys table; passing request through");
    next();
    return;
  }

  const requestHash = hashRequest(req.body, req.originalUrl, req.method);

  // Look up cached response (and prune expired ones lazily)
  try {
    await db.execute(sql`DELETE FROM idempotency_keys WHERE expires_at < NOW()`);

    const result = await db.execute(sql`
      SELECT status, body, content_type, request_hash
      FROM idempotency_keys
      WHERE api_key_id = ${apiKey.id} AND key = ${idempotencyKey}
      LIMIT 1
    `);
    const row = (result.rows ?? result)[0] as
      | { status: number; body: string; content_type: string; request_hash: string }
      | undefined;

    if (row) {
      if (row.request_hash !== requestHash) {
        res.status(409).json({
          error: "Idempotency-Key reused with a different request body",
        });
        return;
      }
      res
        .status(row.status)
        .setHeader("Content-Type", row.content_type)
        .setHeader("Idempotency-Replayed", "true")
        .send(row.body);
      return;
    }
  } catch (err) {
    logger.warn({ err }, "Idempotency cache lookup failed; passing request through");
    next();
    return;
  }

  // Capture the response so we can cache it
  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);
  let captured = false;

  const cache = (status: number, body: string, contentType: string): void => {
    if (captured || status >= 500) return; // never cache server errors
    captured = true;
    const expiresAt = new Date(Date.now() + TTL_HOURS * 3600 * 1000);
    void db
      .execute(sql`
        INSERT INTO idempotency_keys (api_key_id, key, status, body, content_type, request_hash, expires_at)
        VALUES (${apiKey.id}, ${idempotencyKey}, ${status}, ${body}, ${contentType}, ${requestHash}, ${expiresAt})
        ON CONFLICT (api_key_id, key) DO NOTHING
      `)
      .catch((err) => logger.warn({ err }, "Failed to persist idempotency response"));
  };

  res.json = ((data: unknown) => {
    cache(res.statusCode, JSON.stringify(data), "application/json");
    return originalJson(data);
  }) as typeof res.json;

  res.send = ((data: unknown) => {
    if (typeof data === "string") {
      cache(res.statusCode, data, res.getHeader("content-type")?.toString() ?? "text/plain");
    }
    return originalSend(data);
  }) as typeof res.send;

  next();
}
