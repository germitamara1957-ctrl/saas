import { type VideoJobResult, type VideoJobStatus } from "./vertexai-types";
import { resolveVertexModelId } from "./vertexai-types";
import { getActiveProvider, getAccessToken } from "./vertexai-provider";
import { logger } from "./logger";

/**
 * Thrown when Vertex AI returns a *transient* failure (5xx, 429, or
 * UNAVAILABLE/INTERNAL in the body). Callers should treat this as
 * "still processing — try again later" rather than a permanent failure.
 */
export class VertexTransientError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message);
    this.name = "VertexTransientError";
  }
}

const TRANSIENT_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const TRANSIENT_BODY_STATUSES = new Set(["UNAVAILABLE", "INTERNAL", "DEADLINE_EXCEEDED", "RESOURCE_EXHAUSTED"]);
const RETRY_DELAYS_MS = [300, 800, 2000, 5000];

/**
 * Fetch with exponential-backoff retry for transient Vertex AI errors.
 *
 * Returns the parsed JSON body. Throws `VertexTransientError` after exhausting
 * retries on transient failures (5xx, 429, body-level UNAVAILABLE/INTERNAL/...),
 * or a plain Error for permanent failures.
 *
 * IMPORTANT: long-running operation polling can return HTTP 200 with a body of
 * shape `{ done: true, error: { code: 503, status: "UNAVAILABLE" } }` — these
 * are *transient* (the underlying processing pipeline blipped, not a real
 * permanent failure of the generation request), and we must retry them just
 * like an HTTP 503. Hence the body inspection runs on every response,
 * regardless of HTTP status.
 */
async function vertexFetchWithRetry<T = unknown>(
  url: string,
  init: RequestInit,
  context: string,
): Promise<T> {
  let lastErr: { status: number; body: string; bodyStatus?: string; isTransient: boolean } | null = null;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (err) {
      // Network-level failure → always transient
      const msg = err instanceof Error ? err.message : String(err);
      lastErr = { status: 0, body: `Network error: ${msg}`, isTransient: true };
      if (attempt < RETRY_DELAYS_MS.length) {
        const delay = RETRY_DELAYS_MS[attempt]!;
        logger.warn({ context, attempt: attempt + 1, delay, err: msg }, "vertex network error — retrying");
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw new VertexTransientError(`${context} failed (network): ${msg}`, 0);
    }

    const body = await response.text();

    // Try to parse as JSON to detect body-level transient markers. Vertex
    // long-running operations may carry transient errors in the body even
    // when the HTTP status is 200.
    let parsed: unknown;
    let bodyStatus: string | undefined;
    let bodyCode: number | undefined;
    let bodyHasError = false;
    try {
      parsed = JSON.parse(body);
      const p = parsed as { error?: { status?: string; code?: number } };
      bodyStatus = p?.error?.status;
      bodyCode = p?.error?.code;
      bodyHasError = !!p?.error;
    } catch { /* non-JSON body — leave parsed undefined */ }

    const httpTransient = TRANSIENT_HTTP_STATUSES.has(response.status);
    const bodyTransient = bodyStatus !== undefined && TRANSIENT_BODY_STATUSES.has(bodyStatus);
    const isTransient = httpTransient || bodyTransient;

    // Success path: HTTP 2xx AND no transient body marker
    if (response.ok && !bodyTransient) {
      return parsed as T;
    }

    // Capture the most informative status code: prefer body.error.code (e.g.
    // 503 for UNAVAILABLE) over the HTTP status (often 200 for body-error
    // cases). Improves retry signaling and downstream telemetry.
    const errStatus = bodyTransient && bodyCode ? bodyCode : response.status;
    lastErr = { status: errStatus, body, bodyStatus, isTransient };

    // Non-transient failure (HTTP 4xx not in our retry set, or 200 with a
    // permanent body error like INVALID_ARGUMENT / safety-filter rejection):
    // bail immediately — retrying won't help.
    if (!isTransient) {
      // For 200 + permanent body error, still throw so getVideoJobStatus can
      // decide what to do (it expects to handle data.error itself, so we
      // re-return the parsed body if HTTP was OK).
      if (response.ok && bodyHasError) return parsed as T;
      break;
    }

    if (attempt >= RETRY_DELAYS_MS.length) break;

    const delay = RETRY_DELAYS_MS[attempt]!;
    logger.warn({ context, attempt: attempt + 1, status: response.status, bodyStatus, delay },
      "vertex transient error — retrying");
    await new Promise((r) => setTimeout(r, delay));
  }

  // Retries exhausted (or non-transient permanent error)
  const finalStatus = lastErr?.status ?? 0;
  const trimmed = (lastErr?.body ?? "").slice(0, 500);
  if (lastErr?.isTransient) {
    throw new VertexTransientError(
      `${context} unavailable after ${RETRY_DELAYS_MS.length + 1} attempts (${finalStatus}${lastErr.bodyStatus ? `/${lastErr.bodyStatus}` : ""}): ${trimmed}`,
      finalStatus || 503,
    );
  }
  throw new Error(`${context} failed: ${finalStatus} ${trimmed}`);
}

export async function generateVideoWithVeo(
  model: string,
  prompt: string,
  durationSeconds = 5,
  sampleCount = 1,
): Promise<VideoJobResult> {
  const provider = await getActiveProvider();
  const token = await getAccessToken(provider);

  const { projectId, location } = provider;
  const vertexModel = resolveVertexModelId(model);

  // Correct endpoint: :predictLongRunning (not :generateVideo)
  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${vertexModel}:predictLongRunning`;

  // Correct request body format per Vertex AI Veo documentation
  const body = {
    instances: [{ prompt }],
    parameters: {
      sampleCount,
      durationSeconds,
    },
  };

  const data = await vertexFetchWithRetry<{ name?: string; error?: { message?: string; status?: string; code?: number } }>(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, "Veo job submit");

  // Defend against HTTP 200 + permanent body error (e.g. INVALID_ARGUMENT,
  // safety filter on prompt). fetchWithRetry would have already retried any
  // transient body status, so anything that reaches here is permanent.
  if (data.error) {
    throw new Error(`Veo submit rejected: ${data.error.status ?? "ERROR"} ${data.error.message ?? body}`);
  }
  if (!data.name) {
    throw new Error("Veo submit returned no operation name");
  }
  return { operationName: data.name };
}

export async function getVideoJobStatus(operationName: string): Promise<VideoJobStatus> {
  const provider = await getActiveProvider();
  const token = await getAccessToken(provider);

  const { projectId, location } = provider;

  // Extract the model name from the operation name
  // Format: projects/{projectId}/locations/{location}/publishers/google/models/{model}/operations/{opId}
  const modelMatch = operationName.match(/\/models\/([^/]+)\//);
  const vertexModel = modelMatch?.[1];

  if (!vertexModel) {
    throw new Error(`Cannot extract model name from operation: ${operationName}`);
  }

  // Correct polling endpoint: :fetchPredictOperation (POST, not GET)
  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${vertexModel}:fetchPredictOperation`;

  const data = await vertexFetchWithRetry<{
    done?: boolean;
    response?: {
      videos?: Array<{
        uri?: string;
        gcsUri?: string;
        bytesBase64Encoded?: string;
        encoding?: string;
        mimeType?: string;
      }>;
      generatedSamples?: Array<{
        video?: { uri?: string; gcsUri?: string; bytesBase64Encoded?: string };
      }>;
      generateVideoResponse?: {
        generatedSamples?: Array<{
          video?: { uri?: string; gcsUri?: string; bytesBase64Encoded?: string };
        }>;
      };
    };
    error?: { message?: string; status?: string; code?: number };
  }>(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ operationName }),
  }, "Veo poll status");

  if (data.error) {
    // Operation came back with error in body. fetchWithRetry has already
    // retried any transient body status (UNAVAILABLE/INTERNAL/...) for us, so
    // if we still see a transient status here, it means it persisted across
    // all attempts → surface it as VertexTransientError so callers (waitForVideo
    // / getVideoStatusForUser) can keep the job in "pending" rather than
    // permanently failing it. Permanent errors (safety filter, INVALID_ARGUMENT,
    // FAILED_PRECONDITION, etc.) still terminate the job as before.
    if (data.error.status && TRANSIENT_BODY_STATUSES.has(data.error.status)) {
      throw new VertexTransientError(
        `Veo operation transient error: ${data.error.status} ${data.error.message ?? ""}`,
        data.error.code ?? 503,
      );
    }
    return { done: true, error: data.error.message };
  }

  if (data.done) {
    // Veo returns the video URL under one of several fields depending on the
    // model version + storage mode. Check all known shapes before giving up.
    const v0 = data.response?.videos?.[0];
    const s0 = data.response?.generatedSamples?.[0]?.video;
    const g0 = data.response?.generateVideoResponse?.generatedSamples?.[0]?.video;

    const videoUri =
      v0?.uri ?? v0?.gcsUri ??
      s0?.uri ?? s0?.gcsUri ??
      g0?.uri ?? g0?.gcsUri;

    // If the video came back inline as base64 rather than a URI, surface it
    // to the caller as a data URL so clients can still render it.
    const inlineB64 =
      v0?.bytesBase64Encoded ??
      s0?.bytesBase64Encoded ??
      g0?.bytesBase64Encoded;
    if (!videoUri && inlineB64) {
      const mime = v0?.mimeType ?? "video/mp4";
      return { done: true, videoUri: `data:${mime};base64,${inlineB64}` };
    }

    if (!videoUri) {
      // Log the raw payload so we can understand what Veo returned.
      console.error("[veo] job done but no video URI found in response:",
        JSON.stringify(data.response));
      return {
        done: true,
        error: "Video generation finished, but no URI was returned by Vertex AI. " +
          "This usually means safety filters blocked the output, or the response " +
          "schema changed. Contact support with jobId for details.",
      };
    }
    return { done: true, videoUri };
  }

  return { done: false };
}
