import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, providersTable } from "@workspace/db";
import { encryptApiKey, decryptApiKey } from "../../lib/crypto";
import { CreateProviderBody, UpdateProviderBody } from "@workspace/api-zod";
import { GoogleAuth } from "google-auth-library";
import { requireAdmin } from "../../middlewares/adminAuth";

const router: IRouter = Router();

function toSafeProvider(p: typeof providersTable.$inferSelect) {
  return {
    id: p.id,
    name: p.name,
    projectId: p.projectId,
    location: p.location,
    isActive: p.isActive,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

router.get("/admin/providers", requireAdmin, async (_req, res): Promise<void> => {
  const providers = await db
    .select()
    .from(providersTable)
    .orderBy(providersTable.createdAt);

  res.json(providers.map(toSafeProvider));
});

router.post("/admin/providers", requireAdmin, async (req, res): Promise<void> => {
  const parsed = CreateProviderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { name, projectId, location, credentialsJson, isActive } = parsed.data;

  let parsedCreds: Record<string, unknown>;
  try {
    parsedCreds = JSON.parse(credentialsJson) as Record<string, unknown>;
  } catch {
    res.status(400).json({ error: "credentialsJson must be valid JSON" });
    return;
  }
  const requiredFields = ["type", "project_id", "private_key", "client_email"];
  const missingFields = requiredFields.filter(f => !(f in parsedCreds));
  if (missingFields.length > 0) {
    res.status(400).json({ error: `Invalid Google service account credentials. Missing fields: ${missingFields.join(", ")}` });
    return;
  }
  if (parsedCreds.type !== "service_account") {
    res.status(400).json({ error: 'Only Google service account credentials (type: "service_account") are supported' });
    return;
  }

  const credentialsEncrypted = encryptApiKey(credentialsJson);

  const [provider] = await db
    .insert(providersTable)
    .values({ name, projectId, location, credentialsEncrypted, isActive })
    .returning();

  res.status(201).json(toSafeProvider(provider));
});

router.put("/admin/providers/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const parsed = UpdateProviderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updates: Partial<typeof providersTable.$inferInsert> = {};
  const { name, projectId, location, credentialsJson, isActive } = parsed.data;

  if (name !== undefined) updates.name = name;
  if (projectId !== undefined) updates.projectId = projectId;
  if (location !== undefined) updates.location = location;
  if (isActive !== undefined) updates.isActive = isActive;

  if (credentialsJson && credentialsJson.trim().length > 0) {
    let parsedCreds: Record<string, unknown>;
    try {
      parsedCreds = JSON.parse(credentialsJson) as Record<string, unknown>;
    } catch {
      res.status(400).json({ error: "credentialsJson must be valid JSON" });
      return;
    }
    const requiredFields = ["type", "project_id", "private_key", "client_email"];
    const missingFields = requiredFields.filter(f => !(f in parsedCreds));
    if (missingFields.length > 0) {
      res.status(400).json({ error: `Invalid Google service account credentials. Missing fields: ${missingFields.join(", ")}` });
      return;
    }
    if (parsedCreds.type !== "service_account") {
      res.status(400).json({ error: 'Only Google service account credentials (type: "service_account") are supported' });
      return;
    }
    updates.credentialsEncrypted = encryptApiKey(credentialsJson);
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  const [provider] = await db
    .update(providersTable)
    .set(updates)
    .where(eq(providersTable.id, id))
    .returning();

  if (!provider) {
    res.status(404).json({ error: "Provider not found" });
    return;
  }

  res.json(toSafeProvider(provider));
});

router.post("/admin/providers/:id/test", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) {
    res.status(400).json({ success: false, message: "Invalid id" });
    return;
  }

  const [provider] = await db
    .select()
    .from(providersTable)
    .where(eq(providersTable.id, id))
    .limit(1);

  if (!provider) {
    res.status(404).json({ success: false, message: "Provider not found" });
    return;
  }

  try {
    const credentialsJson = decryptApiKey(provider.credentialsEncrypted);
    if (!credentialsJson) {
      res.json({ success: false, message: "Failed to decrypt provider credentials" });
      return;
    }
    const credentials = JSON.parse(credentialsJson);

    const auth = new GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });

    const client = await auth.getClient();
    const tokenResponse = await client.getAccessToken();

    if (!tokenResponse.token) {
      res.json({ success: false, message: "Failed to obtain access token from Google — check that the service account key is valid." });
      return;
    }

    // Test Vertex AI access directly using the location endpoint
    const projectId = provider.projectId;
    const location = provider.location;
    const vertexUrl = `https://${location}-aiplatform.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/locations/${encodeURIComponent(location)}`;
    const abortCtrl = new AbortController();
    const fetchTimeout = setTimeout(() => abortCtrl.abort(), 10_000);
    const vertexRes = await fetch(vertexUrl, {
      headers: { Authorization: `Bearer ${tokenResponse.token}` },
      signal: abortCtrl.signal,
    });
    clearTimeout(fetchTimeout);

    if (!vertexRes.ok) {
      const errText = await vertexRes.text();
      // Try to extract a clean error message from JSON error response
      let errMsg = "";
      try {
        const errJson = JSON.parse(errText) as { error?: { message?: string; status?: string } };
        errMsg = errJson?.error?.message ?? errText.slice(0, 300);
      } catch {
        errMsg = errText.slice(0, 300);
      }

      if (vertexRes.status === 403) {
        res.json({ success: false, message: `Access denied to Vertex AI. Make sure the service account has the "Vertex AI User" role on project "${projectId}". Details: ${errMsg}` });
      } else if (vertexRes.status === 404) {
        res.json({ success: false, message: `Location "${location}" not found in project "${projectId}". Check your Project ID and Region.` });
      } else {
        res.json({ success: false, message: `Vertex AI error ${vertexRes.status}: ${errMsg}` });
      }
      return;
    }

    res.json({ success: true, message: `Connection successful — credentials are valid and Vertex AI is accessible in project "${projectId}" (${location}).` });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      res.json({ success: false, message: "Connection timed out after 10 seconds. Verify the Project ID and Region, then try again." });
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    res.json({ success: false, message: msg });
  }
});

router.delete("/admin/providers/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const deleted = await db
    .delete(providersTable)
    .where(eq(providersTable.id, id))
    .returning({ id: providersTable.id });

  if (deleted.length === 0) {
    res.status(404).json({ error: "Provider not found" });
    return;
  }

  res.status(204).end();
});

export default router;
