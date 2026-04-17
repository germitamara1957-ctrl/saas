import { logger } from "./logger";

const TRANSIENT_PG_CODES = new Set([
  "40001", // serialization_failure
  "40P01", // deadlock_detected
  "57P01", // admin_shutdown
  "57P02", // crash_shutdown
  "57P03", // cannot_connect_now
  "08000", // connection_exception
  "08003", // connection_does_not_exist
  "08006", // connection_failure
  "08001", // sqlclient_unable_to_establish_sqlconnection
  "08004", // sqlserver_rejected_establishment_of_sqlconnection
]);

const TRANSIENT_NODE_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  "ECONNREFUSED",
]);

function isTransient(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; message?: string };
  if (e.code && (TRANSIENT_PG_CODES.has(e.code) || TRANSIENT_NODE_CODES.has(e.code))) {
    return true;
  }
  const msg = (e.message ?? "").toLowerCase();
  return (
    msg.includes("connection terminated") ||
    msg.includes("connection ended") ||
    msg.includes("read econnreset") ||
    msg.includes("client has encountered a connection error")
  );
}

export interface DbRetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  label?: string;
}

export async function withDbRetry<T>(
  fn: () => Promise<T>,
  opts: DbRetryOptions = {},
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseDelay = opts.baseDelayMs ?? 50;
  const label = opts.label ?? "db";
  let lastErr: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt >= maxAttempts || !isTransient(err)) {
        throw err;
      }
      const delay = baseDelay * 2 ** (attempt - 1) + Math.floor(Math.random() * 25);
      logger.warn(
        { err, attempt, maxAttempts, delayMs: delay, label },
        "Transient DB error — retrying",
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw lastErr;
}
