import type { Request, Response, NextFunction } from "express";
import { db, usageLogsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import { generateRequestId } from "../lib/crypto";

declare global {
  namespace Express {
    interface Request {
      capturedRequestBody?: string;
      preassignedRequestId?: string;
    }
  }
}

const MAX_BODY = 65536;

function truncate(s: string): string {
  return s.length > MAX_BODY ? s.slice(0, MAX_BODY) + "...[truncated]" : s;
}

/**
 * Capture middleware:
 *   - Pre-assigns a requestId on req.preassignedRequestId so route handlers
 *     can use it (instead of generating their own) for log correlation.
 *   - Wraps res.json to capture the response body.
 *   - On finish, looks up the usage_logs row by requestId (unique within a
 *     short window) and patches it with req/resp body, endpoint, statusCode.
 *   - If no log row exists (e.g. /v1/models, /v1/files, or rate-limited
 *     before logging), the patch is a no-op — never corrupts another row.
 */
export function captureRequestResponse(req: Request, res: Response, next: NextFunction): void {
  req.preassignedRequestId = generateRequestId();
  try { req.capturedRequestBody = truncate(JSON.stringify(req.body ?? {})); }
  catch { req.capturedRequestBody = ""; }

  let captured: string | null = null;
  const origJson = res.json.bind(res);
  res.json = (body: unknown) => {
    try { captured = truncate(JSON.stringify(body)); } catch { captured = "[unserializable]"; }
    return origJson(body);
  };

  res.on("finish", () => {
    if (!req.apiKey || !req.preassignedRequestId) return;
    const endpoint = req.originalUrl.split("?")[0] ?? req.path;
    const statusCode = res.statusCode;
    void (async () => {
      try {
        await db
          .update(usageLogsTable)
          .set({
            requestBody: req.capturedRequestBody ?? null,
            responseBody: captured ?? null,
            endpoint,
            statusCode,
          })
          .where(eq(usageLogsTable.requestId, req.preassignedRequestId!));
      } catch (err) {
        logger.warn({ err }, "logCapture failed");
      }
    })();
  });

  next();
}
