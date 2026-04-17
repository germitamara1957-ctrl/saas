import type { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger";

/**
 * Compatibility guard for /v1/* routes.
 *
 * 1. Strips dangerous prototype-pollution keys from req.body recursively.
 *    (express.json doesn't block these by default; mass-assignment can lead
 *    to RCE in libraries that walk objects naïvely.)
 * 2. Logs (warn) when a payload is unusually deep or wide — useful signal
 *    for spotting probing attacks even when the payload is otherwise legal.
 *
 * Body size is already capped by `express.json({ limit: "1mb" })`, so we
 * don't re-implement that here.
 */

const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const MAX_DEPTH = 16;
const MAX_KEYS_PER_OBJECT = 200;

interface SanitizeStats {
  removedKeys: string[];
  maxDepthReached: number;
  maxKeysSeen: number;
}

function sanitize(value: unknown, depth: number, stats: SanitizeStats): unknown {
  if (depth > stats.maxDepthReached) stats.maxDepthReached = depth;
  if (depth > MAX_DEPTH) return null; // refuse to recurse further

  if (Array.isArray(value)) {
    return value.map((v) => sanitize(v, depth + 1, stats));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > stats.maxKeysSeen) stats.maxKeysSeen = entries.length;
    for (const [k, v] of entries) {
      if (DANGEROUS_KEYS.has(k)) {
        stats.removedKeys.push(k);
        continue;
      }
      out[k] = sanitize(v, depth + 1, stats);
    }
    return out;
  }
  return value;
}

export function compatibilityGuard(req: Request, _res: Response, next: NextFunction): void {
  if (req.body && typeof req.body === "object") {
    const stats: SanitizeStats = { removedKeys: [], maxDepthReached: 0, maxKeysSeen: 0 };
    req.body = sanitize(req.body, 0, stats);

    if (stats.removedKeys.length > 0) {
      logger.warn(
        { path: req.path, removedKeys: stats.removedKeys, ip: req.ip },
        "compatibilityGuard: stripped dangerous keys from request body",
      );
    }
    if (stats.maxDepthReached > MAX_DEPTH || stats.maxKeysSeen > MAX_KEYS_PER_OBJECT) {
      logger.warn(
        { path: req.path, maxDepth: stats.maxDepthReached, maxKeys: stats.maxKeysSeen, ip: req.ip },
        "compatibilityGuard: unusually large or deep payload",
      );
    }
  }
  next();
}
