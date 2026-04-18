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
 * ATOMIC CLAIM PATTERN (concurrency-safe):
 *   1. Before invoking the handler we INSERT a row with `is_pending=true`.
 *      ON CONFLICT DO NOTHING means only one concurrent request can claim a
 *      given (apiKeyId, key) — others see no `RETURNING` row.
 *   2. The losing concurrent request inspects the existing row:
 *        - still pending and fresh  → 409 "Request still in progress"
 *        - completed, hash matches  → replay cached response
 *        - completed, hash differs  → 409 mismatch
 *   3. The winning request runs the handler, then UPDATEs the row with the
 *      final response (or DELETEs on 5xx so the retry can proceed).
 *
 * This eliminates the double-charge race that exists when the cache is
 * checked, then written after the upstream billing call completes.
 *
 * Storage: a small Postgres table `idempotency_keys` (created lazily on
 * first use) so we don't introduce a Redis hard-dependency.
 */

const TTL_HOURS = 24;
// Max time any handler we protect can plausibly run. Set generously above the
// longest billing-sensitive endpoint timeout (video submit ~ a few minutes) to
// avoid concurrent owner / takeover races.
const PENDING_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_KEY_LENGTH = 255;
const MAX_CACHED_BODY_BYTES = 1024 * 1024; // 1 MiB cap on cached body
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
  // Add is_pending + claim_token columns if missing (idempotent migration).
  // claim_token uniquely identifies the request that holds the current lease so
  // that finalize/takeover never overwrites a different owner's row.
  await db.execute(sql`
    ALTER TABLE idempotency_keys
      ADD COLUMN IF NOT EXISTS is_pending BOOLEAN NOT NULL DEFAULT FALSE
  `);
  await db.execute(sql`
    ALTER TABLE idempotency_keys
      ADD COLUMN IF NOT EXISTS claim_token TEXT NOT NULL DEFAULT ''
  `);
  tableEnsured = true;
}

function hashRequest(body: unknown, url: string, method: string): string {
  const payload = JSON.stringify({ body, url, method });
  return crypto.createHash("sha256").update(payload).digest("hex");
}

interface ExistingRow {
  status: number;
  body: string;
  content_type: string;
  request_hash: string;
  is_pending: boolean;
  claim_token: string;
  created_at: Date | string;
}

async function fetchExistingRow(apiKeyId: number, key: string): Promise<ExistingRow | undefined> {
  const result = await db.execute(sql`
    SELECT status, body, content_type, request_hash, is_pending, claim_token, created_at
    FROM idempotency_keys
    WHERE api_key_id = ${apiKeyId} AND key = ${key}
    LIMIT 1
  `);
  const rows = (result as unknown as { rows?: unknown[] }).rows ?? (result as unknown as unknown[]);
  return rows[0] as ExistingRow | undefined;
}

/**
 * Try to atomically claim the idempotency key for this request. Returns the
 * claim token if we own it, or null on conflict.
 */
async function tryClaim(
  apiKeyId: number,
  key: string,
  requestHash: string,
): Promise<string | null> {
  const placeholderExpiresAt = new Date(Date.now() + TTL_HOURS * 3600 * 1000);
  const claimToken = crypto.randomBytes(16).toString("hex");
  const result = await db.execute(sql`
    INSERT INTO idempotency_keys
      (api_key_id, key, status, body, content_type, request_hash, expires_at, is_pending, claim_token)
    VALUES
      (${apiKeyId}, ${key}, 0, '', 'application/json', ${requestHash}, ${placeholderExpiresAt}, TRUE, ${claimToken})
    ON CONFLICT (api_key_id, key) DO NOTHING
    RETURNING 1
  `);
  const rows = (result as unknown as { rows?: unknown[] }).rows ?? (result as unknown as unknown[]);
  return rows.length > 0 ? claimToken : null;
}

/**
 * Atomically take over an existing stale pending row. Returns the new claim
 * token on success, or null if the row is no longer stale or another writer
 * raced ahead. This is a single CAS-style UPDATE (no delete-then-reinsert) so
 * the previous owner cannot finalize on top of the new owner's response.
 */
async function tryTakeover(
  apiKeyId: number,
  key: string,
  oldClaimToken: string,
  staleBefore: Date,
  newRequestHash: string,
): Promise<string | null> {
  const newClaimToken = crypto.randomBytes(16).toString("hex");
  const placeholderExpiresAt = new Date(Date.now() + TTL_HOURS * 3600 * 1000);
  const result = await db.execute(sql`
    UPDATE idempotency_keys
    SET claim_token = ${newClaimToken},
        request_hash = ${newRequestHash},
        created_at = NOW(),
        expires_at = ${placeholderExpiresAt},
        status = 0,
        body = ''
    WHERE api_key_id = ${apiKeyId}
      AND key = ${key}
      AND is_pending = TRUE
      AND claim_token = ${oldClaimToken}
      AND created_at < ${staleBefore}
    RETURNING 1
  `);
  const rows = (result as unknown as { rows?: unknown[] }).rows ?? (result as unknown as unknown[]);
  return rows.length > 0 ? newClaimToken : null;
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

  // Lazy GC of expired rows (best-effort; not on the hot path for correctness).
  db.execute(sql`DELETE FROM idempotency_keys WHERE expires_at < NOW()`).catch(() => {});

  // === Atomic claim phase ===
  let myClaimToken: string | null;
  try {
    myClaimToken = await tryClaim(apiKey.id, idempotencyKey, requestHash);
  } catch (err) {
    logger.warn({ err }, "Idempotency claim failed; passing request through");
    next();
    return;
  }

  if (!myClaimToken) {
    // Another request already holds the key — inspect it.
    let existing: ExistingRow | undefined;
    try {
      existing = await fetchExistingRow(apiKey.id, idempotencyKey);
    } catch (err) {
      logger.warn({ err }, "Idempotency lookup failed after claim conflict; passing request through");
      next();
      return;
    }
    if (!existing) {
      // Race: row was GC'd between INSERT and SELECT. Try once more.
      try {
        myClaimToken = await tryClaim(apiKey.id, idempotencyKey, requestHash);
      } catch (err) {
        logger.warn({ err }, "Idempotency re-claim failed; passing request through");
        next();
        return;
      }
      if (!myClaimToken) {
        res.status(409).json({ error: "Idempotency conflict; please retry" });
        return;
      }
    } else if (existing.is_pending) {
      const createdAt = new Date(existing.created_at);
      const ageMs = Date.now() - createdAt.getTime();
      if (ageMs < PENDING_TIMEOUT_MS) {
        res.status(409).json({
          error: "A request with this Idempotency-Key is still in progress",
        });
        return;
      }
      // Stale pending row — likely a crashed worker. Take it over with an
      // atomic conditional UPDATE that requires the existing claim_token to
      // still be present AND the row to still be older than the stale
      // threshold. If anyone else (the original owner included) modified the
      // row in the meantime the takeover fails harmlessly.
      const staleBefore = new Date(Date.now() - PENDING_TIMEOUT_MS);
      try {
        myClaimToken = await tryTakeover(
          apiKey.id,
          idempotencyKey,
          existing.claim_token,
          staleBefore,
          requestHash,
        );
      } catch (err) {
        logger.warn({ err }, "Idempotency stale-takeover failed; passing through");
        next();
        return;
      }
      if (!myClaimToken) {
        res.status(409).json({ error: "Idempotency conflict; please retry" });
        return;
      }
    } else {
      // Completed row exists.
      if (existing.request_hash !== requestHash) {
        res.status(409).json({ error: "Idempotency-Key reused with a different request body" });
        return;
      }
      res
        .status(existing.status)
        .setHeader("Content-Type", existing.content_type)
        .setHeader("Idempotency-Replayed", "true")
        .send(existing.body);
      return;
    }
  }
  const ourToken: string = myClaimToken;

  // === We own the claim. Execute the handler and persist the result. ===
  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);
  let captured = false;

  const finalize = (status: number, body: string, contentType: string): void => {
    if (captured) return;
    captured = true;

    if (status >= 500) {
      // Server error: drop the placeholder so the client can safely retry.
      // Only delete the row if WE still own it (claim_token match) — otherwise
      // a stale-takeover may have re-leased it to a different request.
      void db.execute(sql`
        DELETE FROM idempotency_keys
        WHERE api_key_id = ${apiKey.id} AND key = ${idempotencyKey}
          AND claim_token = ${ourToken}
      `).catch((err) => logger.warn({ err }, "Failed to drop idempotency placeholder after 5xx"));
      return;
    }

    if (Buffer.byteLength(body, "utf8") > MAX_CACHED_BODY_BYTES) {
      void db.execute(sql`
        DELETE FROM idempotency_keys
        WHERE api_key_id = ${apiKey.id} AND key = ${idempotencyKey}
          AND claim_token = ${ourToken}
      `).catch(() => {});
      return;
    }

    const expiresAt = new Date(Date.now() + TTL_HOURS * 3600 * 1000);
    void db.execute(sql`
      UPDATE idempotency_keys
      SET status = ${status},
          body = ${body},
          content_type = ${contentType},
          expires_at = ${expiresAt},
          is_pending = FALSE
      WHERE api_key_id = ${apiKey.id} AND key = ${idempotencyKey}
        AND claim_token = ${ourToken}
    `).catch((err) => logger.warn({ err }, "Failed to persist idempotency response"));
  };

  res.json = ((data: unknown) => {
    finalize(res.statusCode, JSON.stringify(data), "application/json");
    return originalJson(data);
  }) as typeof res.json;

  res.send = ((data: unknown) => {
    if (typeof data === "string") {
      finalize(res.statusCode, data, res.getHeader("content-type")?.toString() ?? "text/plain");
    } else if (Buffer.isBuffer(data)) {
      finalize(res.statusCode, data.toString("utf8"), res.getHeader("content-type")?.toString() ?? "application/octet-stream");
    }
    return originalSend(data);
  }) as typeof res.send;

  // Safety net: if the handler crashes or never writes a body, release the
  // placeholder — but only if we still own it.
  res.on("close", () => {
    if (!captured) {
      void db.execute(sql`
        DELETE FROM idempotency_keys
        WHERE api_key_id = ${apiKey.id} AND key = ${idempotencyKey}
          AND is_pending = TRUE AND claim_token = ${ourToken}
      `).catch(() => {});
    }
  });

  next();
}
