import { VertexAI } from "@google-cloud/vertexai";
import { GoogleAuth } from "google-auth-library";
import { db, providersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { decryptApiKey } from "./crypto";
import { GEMINI_GLOBAL_LOCATION_MODELS } from "./vertexai-types";

export interface ResolvedProvider {
  projectId: string;
  location: string;
  credentialsJson: string | null;
}

export async function getActiveProvider(): Promise<ResolvedProvider> {
  const [provider] = await db
    .select()
    .from(providersTable)
    .where(eq(providersTable.isActive, true))
    .orderBy(providersTable.createdAt)
    .limit(1);

  if (provider) {
    const credentialsJson = decryptApiKey(provider.credentialsEncrypted);
    return {
      projectId: provider.projectId,
      location: provider.location,
      credentialsJson,
    };
  }

  const project = process.env.GOOGLE_CLOUD_PROJECT;
  if (!project) {
    throw new Error(
      "No active Vertex AI provider configured and GOOGLE_CLOUD_PROJECT env var is not set. " +
        "Add a provider in Admin → Providers."
    );
  }

  return {
    projectId: project,
    location: process.env.GOOGLE_CLOUD_LOCATION ?? "us-central1",
    credentialsJson: null,
  };
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
