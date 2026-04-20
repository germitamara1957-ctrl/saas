import { VertexAI } from "@google-cloud/vertexai";
import { GoogleAuth } from "google-auth-library";
import { db, providersTable, type Provider } from "@workspace/db";
import { and, eq, isNull, or, gt, asc, sql } from "drizzle-orm";
import { decryptApiKey } from "./crypto";
import { GEMINI_GLOBAL_LOCATION_MODELS } from "./vertexai-types";
import { logger } from "./logger";

export interface ResolvedProvider {
  id: number | null;          // null when falling back to env-var provider
  projectId: string;
  location: string;
  credentialsJson: string | null;
}

// Circuit breaker tuning. Exponential backoff capped at 1 hour.
const BASE_BACKOFF_MS = 30_000;            // 30s after first failure
const MAX_BACKOFF_MS = 60 * 60_000;        // 1 hour cap

function backoffMs(consecutiveFailures: number): number {
  const ms = BASE_BACKOFF_MS * Math.pow(2, Math.max(0, consecutiveFailures - 1));
  return Math.min(ms, MAX_BACKOFF_MS);
}

/**
 * Returns the env-var fallback provider when no DB provider is configured.
 * Throws when neither DB nor env is available.
 */
function envFallbackProvider(): ResolvedProvider {
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  if (!project) {
    throw new Error(
      "No active Vertex AI provider configured and GOOGLE_CLOUD_PROJECT env var is not set. " +
        "Add a provider in Admin → Providers."
    );
  }
  return {
    id: null,
    projectId: project,
    location: process.env.GOOGLE_CLOUD_LOCATION ?? "us-central1",
    credentialsJson: null,
  };
}

function rowToResolved(row: Provider): ResolvedProvider {
  const credentialsJson = decryptApiKey(row.credentialsEncrypted);
  return {
    id: row.id,
    projectId: row.projectId,
    location: row.location,
    credentialsJson,
  };
}

/**
 * Returns ALL active providers in priority order, skipping any whose circuit
 * breaker is currently open. Used by the failover wrapper.
 *
 * Falls back to the env-var provider only when no DB provider is healthy.
 */
export async function getHealthyProviders(): Promise<ResolvedProvider[]> {
  const now = new Date();
  const rows = await db
    .select()
    .from(providersTable)
    .where(
      and(
        eq(providersTable.isActive, true),
        // circuit_open_until IS NULL OR circuit_open_until < NOW()
        or(
          isNull(providersTable.circuitOpenUntil),
          gt(sql`${now}`, providersTable.circuitOpenUntil),
        ),
      ),
    )
    .orderBy(asc(providersTable.priority), asc(providersTable.createdAt));

  if (rows.length > 0) return rows.map(rowToResolved);

  // No healthy DB providers. Try env fallback (will throw if unset).
  return [envFallbackProvider()];
}

/**
 * Backward-compatible: returns the single highest-priority healthy provider.
 * Used by callers that don't (yet) wrap with `withVertexProvider`.
 */
export async function getActiveProvider(): Promise<ResolvedProvider> {
  const list = await getHealthyProviders();
  return list[0];
}

/**
 * Marks a provider as healthy (clears the circuit breaker and failure counter).
 * Best-effort — errors are logged but never thrown.
 */
export async function recordProviderSuccess(providerId: number | null): Promise<void> {
  if (providerId == null) return;
  try {
    await db
      .update(providersTable)
      .set({
        consecutiveFailures: 0,
        circuitOpenUntil: null,
        lastError: null,
        lastSuccessAt: new Date(),
      })
      .where(eq(providersTable.id, providerId));
  } catch (err) {
    logger.warn({ err, providerId }, "recordProviderSuccess failed (non-fatal)");
  }
}

/**
 * Marks a provider as failed and opens its circuit breaker for an
 * exponentially backed-off duration based on the consecutive-failures count.
 */
export async function recordProviderFailure(
  providerId: number | null,
  errorMessage: string,
): Promise<void> {
  if (providerId == null) return;
  try {
    // Atomic increment: do the +1 server-side so concurrent failures can't
    // undercount. We then read back the new value to compute backoff and
    // patch circuitOpenUntil in a follow-up update — short window, but the
    // counter itself never loses an event.
    const [updated] = await db
      .update(providersTable)
      .set({
        consecutiveFailures: sql`${providersTable.consecutiveFailures} + 1`,
        lastError: errorMessage.slice(0, 500),
        lastFailureAt: new Date(),
      })
      .where(eq(providersTable.id, providerId))
      .returning({ consecutiveFailures: providersTable.consecutiveFailures });

    const nextFailures = updated?.consecutiveFailures ?? 1;
    const openUntil = new Date(Date.now() + backoffMs(nextFailures));
    await db
      .update(providersTable)
      .set({ circuitOpenUntil: openUntil })
      .where(eq(providersTable.id, providerId));
    logger.warn({ providerId, nextFailures, openUntilMs: openUntil.getTime() - Date.now() }, "Provider circuit opened");
  } catch (err) {
    logger.warn({ err, providerId }, "recordProviderFailure failed (non-fatal)");
  }
}

/**
 * Failover wrapper for streaming operations. Tries each healthy provider
 * for the *setup* phase (e.g. opening the SSE response). Once the stream
 * begins, mid-stream failures cannot fail over (would require replaying
 * partial output) — they bubble up to the caller as normal.
 *
 * Returns the iterator produced by `setup(provider)` from the first
 * provider that doesn't fail before yielding.
 */
export async function withVertexProviderStream<T>(
  setup: (provider: ResolvedProvider) => Promise<AsyncGenerator<T>>,
): Promise<AsyncGenerator<T>> {
  const providers = await getHealthyProviders();
  let lastError: unknown = null;
  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i];
    try {
      const iterator = await setup(provider);
      // Wrap the iterator so the first successful chunk records success.
      return wrapStreamWithSuccessHook(iterator, provider.id);
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      if (!isFailoverEligible(err)) throw err;
      logger.warn({ providerId: provider.id, attempt: i + 1, total: providers.length, err: message }, "Streaming provider failed during setup, attempting failover");
      void recordProviderFailure(provider.id, message);
    }
  }
  if (lastError instanceof Error) throw lastError;
  throw new Error(String(lastError ?? "All Vertex AI providers failed"));
}

async function* wrapStreamWithSuccessHook<T>(
  iterator: AsyncGenerator<T>,
  providerId: number | null,
): AsyncGenerator<T> {
  let recorded = false;
  try {
    for await (const chunk of iterator) {
      if (!recorded) {
        recorded = true;
        void recordProviderSuccess(providerId);
      }
      yield chunk;
    }
  } catch (err) {
    // Mid-stream failure → record (we already got bytes back, so the
    // problem may be transient on Google's side). Don't fail over.
    if (recorded) {
      const msg = err instanceof Error ? err.message : String(err);
      void recordProviderFailure(providerId, `mid-stream: ${msg}`);
    }
    throw err;
  }
}

/**
 * Classifies an error to decide whether to fail over to the next provider.
 *
 * Failover-eligible (provider-specific issues):
 *  - 401/403  : auth/permission/billing problem with this credential
 *  - 429      : quota exceeded for this project
 *  - 5xx      : Google-side outage in this region/project
 *  - network  : timeout, ECONNRESET, ENOTFOUND, etc.
 *
 * NOT failover-eligible (request-specific — same error on any provider):
 *  - 400 invalid_argument
 *  - safety/policy blocks
 *  - 404 model not found
 */
export function isFailoverEligible(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  // Network / timeout errors
  if (/ECONN(RESET|REFUSED|ABORTED)|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|fetch failed|aborted/i.test(message)) return true;
  // HTTP status codes embedded in messages
  const statusMatch = message.match(/\b(4\d{2}|5\d{2})\b/);
  if (statusMatch) {
    const status = parseInt(statusMatch[1], 10);
    if (status === 401 || status === 403 || status === 429) return true;
    if (status >= 500 && status < 600) return true;
    return false;
  }
  // Quota/billing keywords without status code
  if (/quota|exhausted|rate.?limit|billing|disabled|not.?enabled|UNAVAILABLE|INTERNAL/i.test(message)) return true;
  return false;
}

/**
 * Failover wrapper: tries the operation against each healthy provider in
 * priority order. On a provider-specific failure, opens that provider's
 * circuit and tries the next one. On success, marks the provider healthy.
 *
 * If the error is request-specific (e.g. invalid prompt), throws immediately
 * without trying other providers — they'd return the same error.
 *
 * Throws the LAST failover-eligible error (or the only error) if all
 * providers failed.
 */
export async function withVertexProvider<T>(
  operation: (provider: ResolvedProvider) => Promise<T>,
): Promise<T> {
  const providers = await getHealthyProviders();
  let lastError: unknown = null;
  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i];
    try {
      const result = await operation(provider);
      void recordProviderSuccess(provider.id); // fire-and-forget
      return result;
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      if (!isFailoverEligible(err)) {
        // Request-specific error → don't waste other providers on the same issue.
        throw err;
      }
      logger.warn({ providerId: provider.id, attempt: i + 1, total: providers.length, err: message }, "Provider failed, attempting failover");
      void recordProviderFailure(provider.id, message);
      // Loop continues to next provider
    }
  }
  // All providers exhausted
  if (lastError instanceof Error) throw lastError;
  throw new Error(String(lastError ?? "All Vertex AI providers failed"));
}

export function buildVertexAI(provider: ResolvedProvider): VertexAI {
  if (provider.credentialsJson) {
    const credentials = JSON.parse(provider.credentialsJson);
    return new VertexAI({
      project: provider.projectId,
      location: provider.location,
      googleAuthOptions: { credentials },
    });
  }
  return new VertexAI({ project: provider.projectId, location: provider.location });
}

/**
 * Like buildVertexAI but overrides location to "global" for models that
 * are only available on the Vertex AI global endpoint (e.g. Gemini 3.x previews).
 */
export function buildVertexAIForModel(provider: ResolvedProvider, resolvedModel: string): VertexAI {
  const location = GEMINI_GLOBAL_LOCATION_MODELS.has(resolvedModel) ? "global" : provider.location;
  if (provider.credentialsJson) {
    const credentials = JSON.parse(provider.credentialsJson);
    return new VertexAI({ project: provider.projectId, location, googleAuthOptions: { credentials } });
  }
  return new VertexAI({ project: provider.projectId, location });
}

export function buildAuth(provider: ResolvedProvider): GoogleAuth {
  if (provider.credentialsJson) {
    const credentials = JSON.parse(provider.credentialsJson);
    return new GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });
  }
  return new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
}

export async function getAccessToken(provider: ResolvedProvider): Promise<string> {
  const auth = buildAuth(provider);
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  if (!tokenResponse.token) throw new Error("Failed to obtain Google access token");
  return tokenResponse.token;
}
