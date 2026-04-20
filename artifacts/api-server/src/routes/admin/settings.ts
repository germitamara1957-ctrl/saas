import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, systemSettingsTable } from "@workspace/db";
import { encryptApiKey, decryptApiKey } from "../../lib/crypto";
import { requireAdmin } from "../../middlewares/adminAuth";
import { z } from "zod";

const router: IRouter = Router();

const SENSITIVE_KEYS = new Set(["smtp_pass"]);

const ALLOWED_KEYS = new Set([
  "smtp_host",
  "smtp_port",
  "smtp_user",
  "smtp_pass",
  "smtp_from",
  "app_base_url",
  "docs_videos",
  "signup_allowed_email_domains",
  "signup_blocked_email_domains",
  "signup_block_disposable",
  "signup_official_providers_only",
]);

const httpUrl = z
  .string()
  .trim()
  .url()
  .max(2048)
  .refine(
    (s) => {
      try {
        const proto = new URL(s).protocol;
        return proto === "http:" || proto === "https:";
      } catch {
        return false;
      }
    },
    { message: "URL must use http:// or https://" },
  );

const DocsVideoSchema = z.object({
  title: z.string().trim().min(1).max(200),
  url: httpUrl,
});

const UpdateSettingsBody = z.object({
  smtp_host: z.string().max(253).optional(),
  smtp_port: z.coerce.number().int().min(1).max(65535).optional(),
  smtp_user: z.string().max(320).optional(),
  smtp_pass: z.string().max(500).optional(),
  smtp_from: z.string().max(320).optional(),
  app_base_url: z.string().url().max(2048).optional(),
  docs_videos: z.array(DocsVideoSchema).max(50).optional(),
  signup_allowed_email_domains: z.string().max(2000).optional(),
  signup_blocked_email_domains: z.string().max(2000).optional(),
  signup_block_disposable: z.union([z.boolean(), z.enum(["true", "false"])]).optional(),
  signup_official_providers_only: z.union([z.boolean(), z.enum(["true", "false"])]).optional(),
});

const JSON_KEYS = new Set(["docs_videos"]);

router.get("/admin/settings", requireAdmin, async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(systemSettingsTable)
    .where(
      eq(systemSettingsTable.key, systemSettingsTable.key)
    );

  const result: Record<string, unknown> = {};
  for (const row of rows) {
    if (!ALLOWED_KEYS.has(row.key)) continue;
    if (SENSITIVE_KEYS.has(row.key)) {
      result[row.key] = row.value ? "••••••••" : null;
    } else if (JSON_KEYS.has(row.key)) {
      try {
        result[row.key] = row.value ? JSON.parse(row.value) : null;
      } catch {
        result[row.key] = null;
      }
    } else {
      result[row.key] = row.value;
    }
  }

  const missing: Record<string, unknown> = {};
  for (const key of ALLOWED_KEYS) {
    if (!(key in result)) missing[key] = JSON_KEYS.has(key) ? [] : null;
  }

  res.json({ ...missing, ...result });
});

router.put("/admin/settings", requireAdmin, async (req, res): Promise<void> => {
  const parsed = UpdateSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const data = parsed.data;
  const upserts: Array<typeof systemSettingsTable.$inferInsert> = [];

  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    const isSensitive = SENSITIVE_KEYS.has(k);
    const isJson = JSON_KEYS.has(k);
    const strVal = isJson ? JSON.stringify(v) : String(v);

    if (isSensitive && strVal === "••••••••") {
      continue;
    }

    upserts.push({
      key: k,
      value: isSensitive ? encryptApiKey(strVal) : strVal,
      encrypted: isSensitive,
    });
  }

  for (const row of upserts) {
    await db
      .insert(systemSettingsTable)
      .values(row)
      .onConflictDoUpdate({
        target: systemSettingsTable.key,
        set: { value: row.value, encrypted: row.encrypted },
      });
  }

  // Invalidate caches for any setting groups that were touched.
  if (upserts.some((u) => u.key.startsWith("signup_"))) {
    const { invalidateEmailPolicyCache } = await import("../../lib/emailPolicy");
    invalidateEmailPolicyCache();
  }

  res.json({ ok: true });
});

router.post("/admin/settings/test-email", requireAdmin, async (req, res): Promise<void> => {
  const { to } = req.body as { to?: string };
  if (!to || typeof to !== "string") {
    res.status(400).json({ error: "to is required" });
    return;
  }

  try {
    const { sendEmail } = await import("../../lib/email");
    await sendEmail({
      to,
      subject: "SMTP Test — AI Gateway",
      html: `<div style="font-family:sans-serif;padding:24px"><h2>✅ SMTP is working!</h2><p>This is a test email from your AI Gateway platform.</p><p style="color:#666;font-size:12px">Sent at: ${new Date().toISOString()}</p></div>`,
      text: `SMTP Test — AI Gateway\n\nSMTP is working! This is a test email from your AI Gateway platform.\n\nSent at: ${new Date().toISOString()}`,
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to send test email" });
  }
});

export async function getSettingValue(key: string): Promise<string | null> {
  const rows = await db
    .select()
    .from(systemSettingsTable)
    .where(eq(systemSettingsTable.key, key))
    .limit(1);

  if (!rows.length || rows[0].value === null) return null;
  const row = rows[0];
  if (row.encrypted) {
    return decryptApiKey(row.value!) ?? null;
  }
  return row.value;
}

export default router;
