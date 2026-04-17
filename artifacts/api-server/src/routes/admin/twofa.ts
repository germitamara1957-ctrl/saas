import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { authenticator } from "otplib";
import qrcode from "qrcode";
import { db, usersTable } from "@workspace/db";
import { encryptApiKey, decryptApiKey } from "../../lib/crypto";
import { logAuditEvent } from "./auditLog";

/**
 * 2FA (TOTP) for admin accounts.
 *
 * Flow:
 *   1. POST /admin/2fa/setup       → generates a fresh TOTP secret (encrypted at rest)
 *                                    and returns a QR-code data URL the admin scans.
 *                                    `totpEnabled` stays `false` until the admin verifies.
 *   2. POST /admin/2fa/verify      → validates a 6-digit TOTP code; on success flips
 *                                    `totpEnabled = true`. From this moment on, login
 *                                    requires `totpCode` in addition to the password.
 *   3. POST /admin/2fa/disable     → requires a valid TOTP code; disables 2FA and
 *                                    clears the secret.
 *   4. GET  /admin/2fa/status      → returns `{ enabled }` for the current admin.
 *
 * Storage: `users.totp_secret` is encrypted with the same AES-256-GCM helper used
 * for API-key envelope encryption. The plaintext secret is shown to the admin
 * once during setup so they can manually enter it into a password manager if the
 * QR code is unavailable; afterwards only the encrypted blob is persisted.
 */

// otplib defaults are RFC-6238 compatible (SHA1, 30s window, 6 digits).
authenticator.options = { window: 1 };

const router: IRouter = Router();

router.get("/admin/2fa/status", async (req, res): Promise<void> => {
  const userId = Number(req.authUser!.sub);
  const [user] = await db
    .select({ totpEnabled: usersTable.totpEnabled })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  res.json({ enabled: user.totpEnabled });
});

router.post("/admin/2fa/setup", async (req, res): Promise<void> => {
  const userId = Number(req.authUser!.sub);
  const [user] = await db
    .select({ id: usersTable.id, email: usersTable.email, totpEnabled: usersTable.totpEnabled })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  if (user.totpEnabled) {
    res.status(409).json({ error: "2FA is already enabled. Disable it first to re-provision." });
    return;
  }

  const secret = authenticator.generateSecret();
  const issuer = "AI Gateway";
  const otpauthUrl = authenticator.keyuri(user.email, issuer, secret);
  const qrDataUrl = await qrcode.toDataURL(otpauthUrl);

  // Persist (encrypted) but DO NOT enable yet — verification gate.
  await db.update(usersTable)
    .set({ totpSecret: encryptApiKey(secret), totpEnabled: false })
    .where(eq(usersTable.id, userId));

  res.json({ secret, qrDataUrl, otpauthUrl });
});

router.post("/admin/2fa/verify", async (req, res): Promise<void> => {
  const userId = Number(req.authUser!.sub);
  const code = String(req.body?.code ?? "").trim();
  if (!/^\d{6}$/.test(code)) {
    res.status(400).json({ error: "Code must be 6 digits" });
    return;
  }
  const [user] = await db
    .select({ id: usersTable.id, email: usersTable.email, totpSecret: usersTable.totpSecret })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (!user || !user.totpSecret) {
    res.status(400).json({ error: "Run /admin/2fa/setup first" });
    return;
  }
  const secret = decryptApiKey(user.totpSecret);
  if (!secret) { res.status(500).json({ error: "Failed to read 2FA secret" }); return; }
  const ok = authenticator.check(code, secret);
  if (!ok) { res.status(401).json({ error: "Invalid code" }); return; }

  await db.update(usersTable)
    .set({ totpEnabled: true })
    .where(eq(usersTable.id, userId));

  await logAuditEvent({
    action: "admin.2fa.enabled",
    actorId: user.id,
    actorEmail: user.email,
    ip: req.ip ?? "unknown",
  });

  res.json({ enabled: true });
});

router.post("/admin/2fa/disable", async (req, res): Promise<void> => {
  const userId = Number(req.authUser!.sub);
  const code = String(req.body?.code ?? "").trim();
  const [user] = await db
    .select({ id: usersTable.id, email: usersTable.email, totpSecret: usersTable.totpSecret, totpEnabled: usersTable.totpEnabled })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  if (!user.totpEnabled || !user.totpSecret) {
    res.status(409).json({ error: "2FA is not enabled" });
    return;
  }
  const secret = decryptApiKey(user.totpSecret);
  if (!secret || !authenticator.check(code, secret)) {
    res.status(401).json({ error: "Invalid code" });
    return;
  }

  await db.update(usersTable)
    .set({ totpEnabled: false, totpSecret: null })
    .where(eq(usersTable.id, userId));

  await logAuditEvent({
    action: "admin.2fa.disabled",
    actorId: user.id,
    actorEmail: user.email,
    ip: req.ip ?? "unknown",
  });

  res.json({ enabled: false });
});

export default router;
