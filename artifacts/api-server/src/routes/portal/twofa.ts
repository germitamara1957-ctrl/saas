import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { authenticator } from "otplib";
import qrcode from "qrcode";
import { db, usersTable } from "@workspace/db";
import { encryptApiKey, decryptApiKey } from "../../lib/crypto";

/**
 * 2FA (TOTP) for developer/portal accounts.
 *
 * Mirrors `routes/admin/twofa.ts` but uses portal session auth (`req.authUser`
 * populated by `requireAuth` mounted on `/portal/2fa`). The same encrypted
 * `users.totp_secret` and `users.totp_enabled` columns are reused since they
 * live on the shared users table.
 */

authenticator.options = { window: 1 };

const router: IRouter = Router();

router.get("/status", async (req, res): Promise<void> => {
  const userId = Number(req.authUser!.sub);
  const [user] = await db
    .select({ totpEnabled: usersTable.totpEnabled })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  res.json({ enabled: user.totpEnabled });
});

router.post("/setup", async (req, res): Promise<void> => {
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

  await db.update(usersTable)
    .set({ totpSecret: encryptApiKey(secret), totpEnabled: false })
    .where(eq(usersTable.id, userId));

  res.json({ secret, qrDataUrl, otpauthUrl });
});

router.post("/verify", async (req, res): Promise<void> => {
  const userId = Number(req.authUser!.sub);
  const code = String(req.body?.code ?? "").trim();
  if (!/^\d{6}$/.test(code)) {
    res.status(400).json({ error: "Code must be 6 digits" });
    return;
  }
  const [user] = await db
    .select({ id: usersTable.id, totpSecret: usersTable.totpSecret })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (!user || !user.totpSecret) {
    res.status(400).json({ error: "Run /portal/2fa/setup first" });
    return;
  }
  const secret = decryptApiKey(user.totpSecret);
  if (!secret) { res.status(500).json({ error: "Failed to read 2FA secret" }); return; }
  if (!authenticator.check(code, secret)) {
    res.status(401).json({ error: "Invalid code" });
    return;
  }

  await db.update(usersTable)
    .set({ totpEnabled: true })
    .where(eq(usersTable.id, userId));

  res.json({ enabled: true });
});

router.post("/disable", async (req, res): Promise<void> => {
  const userId = Number(req.authUser!.sub);
  const code = String(req.body?.code ?? "").trim();
  const [user] = await db
    .select({ id: usersTable.id, totpSecret: usersTable.totpSecret, totpEnabled: usersTable.totpEnabled })
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

  res.json({ enabled: false });
});

export default router;
