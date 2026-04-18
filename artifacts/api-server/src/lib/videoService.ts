/**
 * Shared video service — single source of truth for video generation logic.
 *
 * Both `/v1/video` (native shape) and `/v1/videos` (OpenAI Sora-compat shape)
 * call these functions directly. NO HTTP loopback — just function calls.
 */
import type { Response } from "express";
import { createHash } from "crypto";
import { eq, sql, and } from "drizzle-orm";
import { db, usersTable, usageLogsTable, organizationsTable } from "@workspace/db";
import type { ApiKeyWithRelations } from "../middlewares/apiKeyAuth";
import { checkRateLimit } from "./rateLimit";
import { generateVideoWithVeo, getVideoJobStatus, normalizeToPlanModelId } from "./vertexai";
import { VertexTransientError } from "./vertexai-veo";
import { calculateVideoCost } from "./billing";
import { isModelInPlan } from "./chatUtils";
import { logger } from "./logger";

// How long a job may stay "pending" while Vertex returns transient errors
// before we give up, refund, and surface a permanent failure to the client.
const STALE_JOB_GRACE_MS = 30 * 60 * 1000; // 30 minutes

// ─── In-memory idempotency cache ─────────────────────────────────────────────
const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;
interface IdempotentEntry {
  jobId: string;
  operationName: string;
  costUsd: number;
  createdAt: number;
}
const idempotencyCache = new Map<string, IdempotentEntry>();

function idempotencyKey(apiKeyId: number, model: string, prompt: string, durationSeconds: number, sampleCount: number): string {
  return createHash("sha256")
    .update(`${apiKeyId}:${model}:${prompt}:${durationSeconds}:${sampleCount}`)
    .digest("hex");
}

function getIdempotent(key: string): IdempotentEntry | null {
  const hit = idempotencyCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.createdAt > IDEMPOTENCY_TTL_MS) {
    idempotencyCache.delete(key);
    return null;
  }
  return hit;
}

// Poll a Veo operation until it completes or the timeout elapses.
// Tolerates up to 5 *consecutive* transient errors so brief Vertex outages
// (the "Visibility check unavailable" 503 we see in the wild) don't kill
// long-running 8-second video jobs.
const MAX_CONSECUTIVE_POLL_ERRORS = 5;
export async function waitForVideo(operationName: string, timeoutMs: number, pollMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let consecutiveErrors = 0;
  while (Date.now() < deadline) {
    try {
      const status = await getVideoJobStatus(operationName);
      consecutiveErrors = 0;
      if (status.done) return status;
    } catch (err) {
      if (err instanceof VertexTransientError) {
        consecutiveErrors++;
        logger.warn({ operationName, consecutiveErrors, statusCode: err.statusCode },
          "Transient error polling Veo — will retry");
        if (consecutiveErrors >= MAX_CONSECUTIVE_POLL_ERRORS) {
          return {
            done: true as const,
            error: `Vertex AI is temporarily unavailable (HTTP ${err.statusCode}) and ${MAX_CONSECUTIVE_POLL_ERRORS} consecutive status checks failed. Please retry your request in a minute.`,
          };
        }
      } else {
        // Permanent error — fail fast
        throw err;
      }
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return { done: false as const };
}

/**
 * Atomically refund a failed video job.
 * Top-up is used because it works universally (any model).
 *
 * The refund target is derived from the original usage log row: if
 * `organizationId` was stamped at debit time, refund the organization;
 * otherwise refund the user. This guarantees the refund lands on the
 * SAME ledger that was originally charged — preventing tenant leakage.
 */
export async function refundFailedVideoJob(
  jobId: string,
  apiKeyId: number,
  userId: number,
  errorMessage: string,
): Promise<{ refunded: boolean; amount: number }> {
  return db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(usageLogsTable)
      .set({ status: "refunded", errorMessage: `Refunded: ${errorMessage}` })
      .where(and(
        eq(usageLogsTable.requestId, jobId),
        eq(usageLogsTable.apiKeyId, apiKeyId),
        eq(usageLogsTable.status, "success"),
      ))
      .returning({
        costUsd: usageLogsTable.costUsd,
        organizationId: usageLogsTable.organizationId,
      });
    if (!claimed || claimed.costUsd <= 0) return { refunded: false, amount: 0 };

    if (claimed.organizationId !== null) {
      await tx
        .update(organizationsTable)
        .set({ topupCreditBalance: sql`${organizationsTable.topupCreditBalance} + ${claimed.costUsd}` })
        .where(eq(organizationsTable.id, claimed.organizationId));
    } else {
      await tx
        .update(usersTable)
        .set({ topupCreditBalance: sql`${usersTable.topupCreditBalance} + ${claimed.costUsd}` })
        .where(eq(usersTable.id, userId));
    }
    return { refunded: true, amount: claimed.costUsd };
  });
}

export type CreateVideoResult =
  | { ok: true; jobId: string; operationName: string; costUsd: number; model: string; duplicateOf?: string }
  | { ok: false; status: number; error: string };

export interface CreateVideoArgs {
  apiKey: ApiKeyWithRelations;
  model: string;
  prompt: string;
  durationSeconds: number;
  sampleCount: number;
  requestId: string;
}

/**
 * Create a Veo video job — handles validation, plan/credit check, rate limit,
 * Veo API call, atomic deduction, and idempotency.
 *
 * Returns either { ok: true, ... } with operation details, or { ok: false, status, error }
 * which the caller maps to an HTTP response.
 */
export async function createVideoJob(args: CreateVideoArgs): Promise<CreateVideoResult> {
  const { apiKey, model, prompt, durationSeconds, sampleCount, requestId } = args;

  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return { ok: false, status: 400, error: "durationSeconds must be a positive integer" };
  }
  if (!Number.isFinite(sampleCount) || sampleCount < 1 || sampleCount > 4) {
    return { ok: false, status: 400, error: "sampleCount must be an integer between 1 and 4" };
  }
  if (!model.startsWith("veo-")) {
    return {
      ok: false, status: 400,
      error: `Model "${model}" is not supported on this endpoint. Only Veo models (veo-*) are accepted.`,
    };
  }

  // Idempotency
  const idemKey = idempotencyKey(apiKey.id, model, prompt, durationSeconds, sampleCount);
  const existing = getIdempotent(idemKey);
  if (existing) {
    return {
      ok: true,
      jobId: existing.jobId,
      operationName: existing.operationName,
      costUsd: existing.costUsd,
      model,
      duplicateOf: existing.jobId,
    };
  }

  // Resolve billing target (user or org). All usage_logs writes stamp the
  // org id when applicable so refunds and analytics target the right ledger.
  const billingTarget = apiKey.billingTarget;
  const orgIdForLogs: number | null = billingTarget.targetType === "org" ? billingTarget.id : null;

  // Plan + credit check
  const allowed = apiKey.plan.modelsAllowed;
  const planModel = normalizeToPlanModelId(model);
  const modelInPlan = isModelInPlan(allowed, planModel);
  if (!modelInPlan && apiKey.topupCredit <= 0) {
    const errMsg = `Model "${model}" is not in your plan ("${apiKey.plan.name}"). ` +
      `Use top-up credit or upgrade your plan. Plan models: ${allowed.join(", ")}`;
    await db.insert(usageLogsTable).values({
      apiKeyId: apiKey.id, organizationId: orgIdForLogs, model, inputTokens: 0, outputTokens: 0,
      totalTokens: 0, costUsd: 0, requestId, status: "rejected", errorMessage: errMsg,
    });
    return { ok: false, status: 403, error: errMsg };
  }

  // Rate limit (per-key override or per-user; group "video")
  const rpm = apiKey.rpmLimit ?? apiKey.plan.rpm;
  const bucket = apiKey.rpmLimit ? -apiKey.id : apiKey.userId;
  const withinLimit = await checkRateLimit(bucket, rpm, "video");
  if (!withinLimit) {
    const errMsg = `Rate limit exceeded for video group. Your account allows ${rpm} requests per minute.`;
    await db.insert(usageLogsTable).values({
      apiKeyId: apiKey.id, organizationId: orgIdForLogs, model, inputTokens: 0, outputTokens: 0,
      totalTokens: 0, costUsd: 0, requestId, status: "rejected", errorMessage: errMsg,
    });
    return { ok: false, status: 429, error: errMsg };
  }

  const costUsd = calculateVideoCost(planModel, durationSeconds);
  const availableForThisModel = modelInPlan ? apiKey.accountCreditBalance : apiKey.topupCredit;
  if (availableForThisModel < costUsd) {
    const errMsg = modelInPlan
      ? "Insufficient credits for this request."
      : `Insufficient top-up credit for out-of-plan model "${model}".`;
    await db.insert(usageLogsTable).values({
      apiKeyId: apiKey.id, organizationId: orgIdForLogs, model, inputTokens: 0, outputTokens: 0,
      totalTokens: 0, costUsd: 0, requestId, status: "rejected", errorMessage: errMsg,
    });
    return { ok: false, status: 402, error: errMsg };
  }

  // Call Veo
  let jobResult;
  try {
    jobResult = await generateVideoWithVeo(model, prompt, durationSeconds, sampleCount);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    await db.insert(usageLogsTable).values({
      apiKeyId: apiKey.id, organizationId: orgIdForLogs, model, inputTokens: 0, outputTokens: 0,
      totalTokens: 0, costUsd: 0, requestId, jobOperationId: null, status: "error", errorMessage,
    });
    return { ok: false, status: 502, error: `Veo API error: ${errorMessage}` };
  }

  // Atomically deduct + log in a single transaction (split-balance logic).
  // If the API key is org-bound, debit the organization pool; otherwise
  // debit the user. The usage_logs row is stamped with the same target.
  let sufficient = true;
  await db.transaction(async (tx) => {
    let deductedRow;
    if (billingTarget.targetType === "org") {
      const orgId = billingTarget.id;
      deductedRow = modelInPlan
        ? (await tx
            .update(organizationsTable)
            .set({
              creditBalance: sql`GREATEST(${organizationsTable.creditBalance} - ${costUsd}, 0)`,
              topupCreditBalance: sql`${organizationsTable.topupCreditBalance} - GREATEST(${costUsd} - ${organizationsTable.creditBalance}, 0)`,
            })
            .where(and(
              eq(organizationsTable.id, orgId),
              sql`(${organizationsTable.creditBalance} + ${organizationsTable.topupCreditBalance}) >= ${costUsd}`,
            ))
            .returning({ id: organizationsTable.id }))[0]
        : (await tx
            .update(organizationsTable)
            .set({ topupCreditBalance: sql`${organizationsTable.topupCreditBalance} - ${costUsd}` })
            .where(and(
              eq(organizationsTable.id, orgId),
              sql`${organizationsTable.topupCreditBalance} >= ${costUsd}`,
            ))
            .returning({ id: organizationsTable.id }))[0];
    } else {
      deductedRow = modelInPlan
        ? (await tx
            .update(usersTable)
            .set({
              creditBalance: sql`GREATEST(${usersTable.creditBalance} - ${costUsd}, 0)`,
              topupCreditBalance: sql`${usersTable.topupCreditBalance} - GREATEST(${costUsd} - ${usersTable.creditBalance}, 0)`,
            })
            .where(and(
              eq(usersTable.id, apiKey.userId),
              sql`(${usersTable.creditBalance} + ${usersTable.topupCreditBalance}) >= ${costUsd}`,
            ))
            .returning({ id: usersTable.id }))[0]
        : (await tx
            .update(usersTable)
            .set({ topupCreditBalance: sql`${usersTable.topupCreditBalance} - ${costUsd}` })
            .where(and(
              eq(usersTable.id, apiKey.userId),
              sql`${usersTable.topupCreditBalance} >= ${costUsd}`,
            ))
            .returning({ id: usersTable.id }))[0];
    }

    if (!deductedRow) {
      sufficient = false;
      await tx.insert(usageLogsTable).values({
        apiKeyId: apiKey.id, organizationId: orgIdForLogs, model, inputTokens: 0,
        outputTokens: durationSeconds, totalTokens: durationSeconds, costUsd: 0, requestId,
        jobOperationId: jobResult.operationName, status: "rejected",
        errorMessage: modelInPlan
          ? "Insufficient credits (concurrent request exhausted balance)"
          : `Insufficient top-up credit — model "${model}" is out-of-plan`,
      });
      return;
    }

    await tx.insert(usageLogsTable).values({
      apiKeyId: apiKey.id, organizationId: orgIdForLogs, model, inputTokens: 0,
      outputTokens: durationSeconds, totalTokens: durationSeconds, costUsd, requestId,
      jobOperationId: jobResult.operationName, status: "success", errorMessage: null,
    });
  });

  if (!sufficient) {
    return { ok: false, status: 402, error: "Insufficient credits to complete this request." };
  }

  idempotencyCache.set(idemKey, {
    jobId: requestId, operationName: jobResult.operationName, costUsd, createdAt: Date.now(),
  });

  return { ok: true, jobId: requestId, operationName: jobResult.operationName, costUsd, model };
}

export type StatusResult =
  | { ok: true; jobId: string; status: "pending" | "completed" | "failed"; videoUri: string | null;
      errorMessage: string | null; model: string; costUsd: number;
      refunded?: boolean; refundAmount?: number }
  | { ok: false; status: number; error: string };

/**
 * Get the status of a video job for a user (auto-refunds on Veo failure).
 */
export async function getVideoStatusForUser(apiKey: ApiKeyWithRelations, jobId: string): Promise<StatusResult> {
  const rows = await db
    .select({
      jobOperationId: usageLogsTable.jobOperationId,
      model: usageLogsTable.model,
      costUsd: usageLogsTable.costUsd,
      createdAt: usageLogsTable.createdAt,
    })
    .from(usageLogsTable)
    .where(and(eq(usageLogsTable.requestId, jobId), eq(usageLogsTable.apiKeyId, apiKey.id)))
    .limit(1);

  if (rows.length === 0) {
    return { ok: false, status: 404, error: "Job not found" };
  }
  const row = rows[0]!;
  if (!row.jobOperationId) {
    return { ok: false, status: 400, error: "Job has no associated operation ID" };
  }

  try {
    const opStatus = await getVideoJobStatus(row.jobOperationId);
    if (opStatus.done) {
      const err = "error" in opStatus ? opStatus.error : undefined;
      let refund = { refunded: false, amount: 0 };
      if (err) {
        refund = await refundFailedVideoJob(jobId, apiKey.id, apiKey.userId, err);
      }
      return {
        ok: true,
        jobId,
        status: err ? "failed" : "completed",
        videoUri: err ? null : (opStatus.videoUri ?? null),
        errorMessage: err ?? null,
        model: row.model,
        costUsd: err && refund.refunded ? 0 : row.costUsd,
        refunded: err ? refund.refunded : undefined,
        refundAmount: err && refund.refunded ? refund.amount : undefined,
      };
    }
    return {
      ok: true,
      jobId,
      status: "pending",
      videoUri: null,
      errorMessage: null,
      model: row.model,
      costUsd: row.costUsd,
    };
  } catch (err) {
    if (err instanceof VertexTransientError) {
      // Vertex is temporarily unavailable. If the job is still young, ask the
      // client to keep polling — retries inside vertexai-veo + a fresh poll
      // attempt usually clear it. If the job has been stuck > 30 min, give up,
      // refund, and surface a permanent failure so the user isn't billed for
      // a video they'll never receive.
      const ageMs = Date.now() - new Date(row.createdAt).getTime();
      if (ageMs < STALE_JOB_GRACE_MS) {
        logger.warn({ jobId, ageMs, statusCode: err.statusCode },
          "Transient Vertex error during status check — returning pending so client retries");
        return {
          ok: true,
          jobId,
          status: "pending",
          videoUri: null,
          errorMessage: null,
          model: row.model,
          costUsd: row.costUsd,
        };
      }

      // Stale-job give-up path. Race-safety: do ONE final status re-check
      // before refunding — if the job actually completed between polls, we
      // must NOT refund. The atomic claim inside refundFailedVideoJob (WHERE
      // status='success') gives us a second guard: if a concurrent worker has
      // already settled the log row, our refund will no-op.
      try {
        const finalCheck = await getVideoJobStatus(row.jobOperationId);
        if (finalCheck.done) {
          const finalErr = "error" in finalCheck ? finalCheck.error : undefined;
          let refund = { refunded: false, amount: 0 };
          if (finalErr) {
            refund = await refundFailedVideoJob(jobId, apiKey.id, apiKey.userId, finalErr);
          }
          return {
            ok: true,
            jobId,
            status: finalErr ? "failed" : "completed",
            videoUri: finalErr ? null : (finalCheck.videoUri ?? null),
            errorMessage: finalErr ?? null,
            model: row.model,
            costUsd: finalErr && refund.refunded ? 0 : row.costUsd,
            refunded: finalErr ? refund.refunded : undefined,
            refundAmount: finalErr && refund.refunded ? refund.amount : undefined,
          };
        }
        // Final check still says "pending" without throwing → safe to give up
      } catch (finalErr) {
        // Final check ALSO threw a transient error — Vertex is genuinely
        // stuck. Proceed to refund. (A non-transient error is even more
        // grounds to refund.)
        if (!(finalErr instanceof VertexTransientError)) {
          logger.warn({ jobId, finalErr }, "Final re-check failed with permanent error; refunding");
        }
      }

      const reason = `Vertex AI was unavailable for ${Math.round(ageMs / 60000)} minutes. ${err.message}`;
      const refund = await refundFailedVideoJob(jobId, apiKey.id, apiKey.userId, reason);
      logger.error({ jobId, ageMs, statusCode: err.statusCode, refunded: refund.refunded },
        "Gave up on stale video job after prolonged Vertex unavailability");
      return {
        ok: true,
        jobId,
        status: "failed",
        videoUri: null,
        errorMessage: `Vertex AI was unavailable (HTTP ${err.statusCode}) for too long. Your credit was refunded — please retry.`,
        model: row.model,
        costUsd: refund.refunded ? 0 : row.costUsd,
        refunded: refund.refunded,
        refundAmount: refund.refunded ? refund.amount : undefined,
      };
    }
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, status: 502, error: `Veo status check failed: ${errorMessage}` };
  }
}

/**
 * Stream the MP4 bytes for a completed video job to the response.
 * Handles inline data: URIs, gs:// (Google Cloud Storage), and direct HTTPS URLs.
 */
export async function streamVideoContent(
  apiKey: ApiKeyWithRelations,
  jobId: string,
  res: Response,
): Promise<void> {
  const rows = await db
    .select({ jobOperationId: usageLogsTable.jobOperationId, model: usageLogsTable.model })
    .from(usageLogsTable)
    .where(and(eq(usageLogsTable.requestId, jobId), eq(usageLogsTable.apiKeyId, apiKey.id)))
    .limit(1);

  if (rows.length === 0) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  const row = rows[0]!;
  if (!row.jobOperationId) {
    res.status(400).json({ error: "Job has no associated operation ID" });
    return;
  }

  let opStatus;
  try {
    opStatus = await getVideoJobStatus(row.jobOperationId);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    res.status(502).json({ error: `Video download failed: ${errorMessage}` });
    return;
  }

  if (!opStatus.done) {
    res.status(409).json({ error: "Video is still processing — poll status first" });
    return;
  }
  if ("error" in opStatus && opStatus.error) {
    res.status(500).json({ error: opStatus.error });
    return;
  }
  const uri = (opStatus as { videoUri?: string }).videoUri;
  if (!uri) {
    res.status(500).json({ error: "No video URI available for this job" });
    return;
  }

  const fileName = `${jobId}.mp4`;
  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  res.setHeader("Cache-Control", "private, max-age=3600");

  // Case 1: inline data URL
  if (uri.startsWith("data:")) {
    const commaIdx = uri.indexOf(",");
    const b64 = commaIdx >= 0 ? uri.slice(commaIdx + 1) : "";
    const buf = Buffer.from(b64, "base64");
    res.setHeader("Content-Length", buf.length.toString());
    res.end(buf);
    return;
  }

  // Case 2: GCS gs:// URI — auth + HTTPS
  if (uri.startsWith("gs://")) {
    const { getActiveProvider, getAccessToken } = await import("./vertexai-provider");
    const provider = await getActiveProvider();
    const token = await getAccessToken(provider);
    const path = uri.replace("gs://", "");
    const slash = path.indexOf("/");
    const bucket = path.slice(0, slash);
    const object = encodeURIComponent(path.slice(slash + 1));
    const httpsUrl = `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${object}?alt=media`;
    const upstream = await fetch(httpsUrl, { headers: { Authorization: `Bearer ${token}` } });
    if (!upstream.ok || !upstream.body) {
      res.status(502).json({ error: `Failed to fetch video from GCS: ${upstream.status}` });
      return;
    }
    const len = upstream.headers.get("content-length");
    if (len) res.setHeader("Content-Length", len);
    const reader = upstream.body.getReader();
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();
    return;
  }

  // Case 3: plain HTTPS — proxy with SSRF guard
  if (uri.startsWith("http://") || uri.startsWith("https://")) {
    let host: string;
    try { host = new URL(uri).hostname.toLowerCase(); } catch { host = ""; }
    const allowed =
      host === "storage.googleapis.com" ||
      host.endsWith(".storage.googleapis.com") ||
      host.endsWith(".googleusercontent.com");
    if (!allowed) {
      res.status(502).json({ error: `Refusing to proxy untrusted host: ${host}` });
      return;
    }
    const upstream = await fetch(uri);
    if (!upstream.ok || !upstream.body) {
      res.status(502).json({ error: `Failed to fetch video: ${upstream.status}` });
      return;
    }
    const len = upstream.headers.get("content-length");
    if (len) res.setHeader("Content-Length", len);
    const reader = upstream.body.getReader();
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();
    return;
  }

  res.status(500).json({ error: `Unrecognized video URI scheme: ${uri.slice(0, 20)}...` });
}
