import { Router, type IRouter, type Response } from "express";
import { eq, asc } from "drizzle-orm";
import { db, usersTable, apiKeysTable, plansTable } from "@workspace/db";
import { PortalLoginBody, PortalRegisterBody } from "@workspace/api-zod";
import { verifyPassword, hashPassword, generateApiKey, encryptApiKey } from "../../lib/crypto";
import { signToken } from "../../lib/jwt";
import { checkRegistrationLimit, checkLoginLimit, resetLoginLimit } from "../../lib/ipRateLimit";
import { withDbRetry } from "../../lib/dbRetry";
import { sendEmail, buildVerificationEmail, buildPasswordResetEmail } from "../../lib/email";
import { randomBytes } from "node:crypto";
import { logger } from "../../lib/logger";
import { requireAuth } from "../../middlewares/adminAuth";
import { getSettingValue } from "../admin/settings";
import { validateSignupEmail } from "../../lib/emailPolicy";

async function getAppBaseUrl(req?: import("express").Request): Promise<string> {
  const override = await getSettingValue("app_base_url").catch(() => null);
  if (override) return override.replace(/\/$/, "");
  if (req) {
    const proto = (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim() ?? req.protocol;
    const host = (req.headers["x-forwarded-host"] as string | undefined)?.split(",")[0]?.trim() ?? req.hostname;
    return `${proto}://${host}`;
  }
  return (process.env.APP_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`).replace(/\/$/, "");
}

function getClientIp(req: import("express").Request): string {
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

function generateVerificationToken(): string {
  return randomBytes(32).toString("hex");
}

const COOKIE_NAME = "auth_token";

function setAuthCookie(res: Response, token: string): void {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

const router: IRouter = Router();

router.post("/portal/auth/login", async (req, res): Promise<void> => {
  const ip = getClientIp(req);
  const parsed = PortalLoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { email, password } = parsed.data;

  try {
    const limitCheck = await checkLoginLimit(ip, email);
    if (!limitCheck.allowed) {
      const retryAfterSec = Math.ceil(limitCheck.retryAfterMs / 1000);
      res.status(429).json({ error: `Too many login attempts. Please try again in ${retryAfterSec} seconds.` });
      return;
    }

    const [user] = await withDbRetry(
      () =>
        db
          .select()
          .from(usersTable)
          .where(eq(usersTable.email, email))
          .limit(1),
      { label: "login.findUser" },
    );

    if (!user || !user.isActive) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    // 2FA gate (T03 — portal): if totpEnabled, require a valid 6-digit TOTP
    // code in the same login request. The frontend keeps the email+password
    // in state and reposts with `totpCode` after the user enters it.
    if (user.totpEnabled) {
      const totpCode = typeof req.body?.totpCode === "string" ? req.body.totpCode.trim() : "";
      if (!totpCode) {
        res.status(401).json({ error: "2FA code required", totpRequired: true });
        return;
      }
      if (!/^\d{6}$/.test(totpCode)) {
        res.status(401).json({ error: "Invalid 2FA code", totpRequired: true });
        return;
      }
      const { authenticator } = await import("otplib");
      const { decryptApiKey } = await import("../../lib/crypto");
      const secret = user.totpSecret ? decryptApiKey(user.totpSecret) : null;
      if (!secret || !authenticator.check(totpCode, secret)) {
        res.status(401).json({ error: "Invalid 2FA code", totpRequired: true });
        return;
      }
    }

    await resetLoginLimit(ip, email).catch((err) => {
      // Non-critical: rate-limit reset failure should not block successful login.
      logger.warn({ err, email }, "Failed to reset login rate limit after successful login");
    });

    const token = signToken({
      sub: String(user.id),
      email: user.email,
      role: user.role,
      name: user.name,
    });

    setAuthCookie(res, token);

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        isActive: user.isActive,
        emailVerified: user.emailVerified,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    });
  } catch (err) {
    logger.error({ err, email, ip }, "Login handler failed unexpectedly");
    res.status(503).json({
      error: "Service temporarily unavailable. Please try again in a moment.",
    });
  }
});

router.post("/portal/auth/register", async (req, res): Promise<void> => {
  const ip = getClientIp(req);

  const parsed = PortalRegisterBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { name, email, password } = parsed.data;

  // Email policy gate: allowlist / blocklist / disposable filter (configured
  // via /admin/settings → signup_allowed_email_domains, signup_blocked_email_domains,
  // signup_block_disposable). Runs before rate limit so spammers don't burn the IP quota.
  const policyCheck = await validateSignupEmail(email);
  if (!policyCheck.ok) {
    const acceptLang = String(req.headers["accept-language"] ?? "").toLowerCase();
    const isAr = acceptLang.startsWith("ar");
    res.status(400).json({ error: (isAr ? policyCheck.reasonAr : policyCheck.reason) ?? policyCheck.reason });
    return;
  }

  try {
    const limitCheck = await checkRegistrationLimit(ip);
    if (!limitCheck.allowed) {
      const retryAfterHours = Math.ceil(limitCheck.retryAfterMs / 3_600_000);
      res.status(429).json({
        error: `Too many accounts created from this network. Please try again in ${retryAfterHours} hour${retryAfterHours === 1 ? "" : "s"}.`,
      });
      return;
    }

    const [existing] = await withDbRetry(
      () =>
        db
          .select({ id: usersTable.id })
          .from(usersTable)
          .where(eq(usersTable.email, email))
          .limit(1),
      { label: "register.existsCheck" },
    );

    if (existing) {
      res.status(409).json({ error: "An account with this email already exists" });
      return;
    }

    const passwordHash = await hashPassword(password);

    const [freePlan] = await db
      .select()
      .from(plansTable)
      .where(eq(plansTable.isActive, true))
      .orderBy(asc(plansTable.priceUsd), asc(plansTable.id))
      .limit(1);

    const verificationToken = generateVerificationToken();
    const tokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    let user: typeof usersTable.$inferSelect;
    let apiKeyPayload: {
      keyPrefix: string;
      fullKey: string;
      creditBalance: number;
      planName: string;
    } | null = null;

    // Optional referral code from the signup page (?ref=ABC123 → cookie/body).
    // We accept it loosely (not part of the codegen schema yet) and validate
    // inside captureSignupReferral. Self-referral and unknown codes are no-ops.
    const refCodeRaw = typeof (req.body as { refCode?: unknown })?.refCode === "string"
      ? (req.body as { refCode: string }).refCode
      : null;

    await db.transaction(async (tx) => {
      const [newUser] = await tx
        .insert(usersTable)
        .values({
          name,
          email,
          passwordHash,
          role: "developer",
          isActive: true,
          creditBalance: freePlan ? freePlan.monthlyCredits : 0,
          emailVerified: false,
          emailVerificationToken: verificationToken,
          emailVerificationTokenExpiresAt: tokenExpiresAt,
        })
        .returning();

      user = newUser!;

      if (freePlan) {
        const { rawKey, keyHash, keyPrefix } = generateApiKey();
        const keyEncrypted = encryptApiKey(rawKey);

        await tx.insert(apiKeysTable).values({
          userId: user.id,
          planId: freePlan.id,
          keyPrefix,
          keyHash,
          keyEncrypted,
          name: "Default Key",
          creditBalance: 0,
          isActive: true,
        });

        apiKeyPayload = {
          keyPrefix,
          fullKey: rawKey,
          creditBalance: freePlan.monthlyCredits,
          planName: freePlan.name,
        };
      }
    });

    // Capture referral after the transaction so a failure here doesn't
    // roll back the registration. captureSignupReferral is idempotent and
    // self-validates the code.
    if (refCodeRaw) {
      try {
        const { captureSignupReferral } = await import("../../lib/referrals");
        await captureSignupReferral(user!.id, refCodeRaw);
      } catch (err) {
        logger.warn({ err, userId: user!.id }, "captureSignupReferral failed (non-fatal)");
      }
    }

    const appBaseUrl = await getAppBaseUrl(req);
    const emailContent = buildVerificationEmail(name, verificationToken, appBaseUrl);
    sendEmail({ to: email, ...emailContent }).catch((err) => {
      logger.warn({ err, email }, "Failed to send verification email after registration");
    });

    const jwtToken = signToken({
      sub: String(user!.id),
      email: user!.email,
      role: user!.role,
      name: user!.name,
    });

    setAuthCookie(res, jwtToken);

    res.status(201).json({
      user: {
        id: user!.id,
        email: user!.email,
        name: user!.name,
        role: user!.role,
        isActive: user!.isActive,
        emailVerified: false,
        createdAt: user!.createdAt,
        updatedAt: user!.updatedAt,
      },
      apiKey: apiKeyPayload,
      verificationEmailSent: true,
    });
  } catch (err) {
    logger.error({ err, email, ip }, "Register handler failed unexpectedly");
    res.status(503).json({
      error: "Service temporarily unavailable. Please try again in a moment.",
    });
  }
});

router.get("/portal/auth/verify-email", async (req, res): Promise<void> => {
  const token = req.query?.token;
  if (!token || typeof token !== "string") {
    const appBaseUrl = await getAppBaseUrl(req);
    res.redirect(`${appBaseUrl}/login?verified=error&reason=missing_token`);
    return;
  }

  const [user] = await db
    .select({
      id: usersTable.id,
      emailVerified: usersTable.emailVerified,
      emailVerificationToken: usersTable.emailVerificationToken,
      emailVerificationTokenExpiresAt: usersTable.emailVerificationTokenExpiresAt,
    })
    .from(usersTable)
    .where(eq(usersTable.emailVerificationToken, token))
    .limit(1);

  const appBaseUrl = await getAppBaseUrl(req);

  if (!user) {
    res.redirect(`${appBaseUrl}/login?verified=error&reason=invalid`);
    return;
  }

  if (user.emailVerified) {
    res.redirect(`${appBaseUrl}/login?verified=already`);
    return;
  }

  if (!user.emailVerificationTokenExpiresAt || user.emailVerificationTokenExpiresAt < new Date()) {
    res.redirect(`${appBaseUrl}/login?verified=error&reason=expired`);
    return;
  }

  await db
    .update(usersTable)
    .set({
      emailVerified: true,
      emailVerificationToken: null,
      emailVerificationTokenExpiresAt: null,
    })
    .where(eq(usersTable.id, user.id));

  res.redirect(`${appBaseUrl}/login?verified=success`);
});

router.post("/portal/auth/verify-email", async (req, res): Promise<void> => {
  const token = req.body?.token;
  if (!token || typeof token !== "string") {
    res.status(400).json({ error: "Verification token is required" });
    return;
  }

  const [user] = await db
    .select({
      id: usersTable.id,
      emailVerified: usersTable.emailVerified,
      emailVerificationToken: usersTable.emailVerificationToken,
      emailVerificationTokenExpiresAt: usersTable.emailVerificationTokenExpiresAt,
    })
    .from(usersTable)
    .where(eq(usersTable.emailVerificationToken, token))
    .limit(1);

  if (!user) {
    res.status(400).json({ error: "Invalid or expired verification token" });
    return;
  }

  if (user.emailVerified) {
    res.json({ success: true, message: "Email already verified" });
    return;
  }

  if (!user.emailVerificationTokenExpiresAt || user.emailVerificationTokenExpiresAt < new Date()) {
    res.status(400).json({ error: "Verification token has expired. Please request a new one." });
    return;
  }

  await db
    .update(usersTable)
    .set({
      emailVerified: true,
      emailVerificationToken: null,
      emailVerificationTokenExpiresAt: null,
    })
    .where(eq(usersTable.id, user.id));

  res.json({ success: true, message: "Email verified successfully" });
});

router.post("/portal/auth/resend-verification", async (req, res): Promise<void> => {
  const email = req.body?.email;
  if (!email || typeof email !== "string") {
    res.status(400).json({ error: "Email is required" });
    return;
  }

  const [user] = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      name: usersTable.name,
      emailVerified: usersTable.emailVerified,
    })
    .from(usersTable)
    .where(eq(usersTable.email, email.toLowerCase().trim()))
    .limit(1);

  if (!user) {
    res.json({ success: true, message: "If that email exists, a verification link has been sent." });
    return;
  }

  if (user.emailVerified) {
    res.json({ success: true, message: "Email already verified" });
    return;
  }

  const newToken = generateVerificationToken();
  const tokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await db
    .update(usersTable)
    .set({ emailVerificationToken: newToken, emailVerificationTokenExpiresAt: tokenExpiresAt })
    .where(eq(usersTable.id, user.id));

  const appBaseUrl = await getAppBaseUrl(req);
  const emailContent = buildVerificationEmail(user.name, newToken, appBaseUrl);
  try {
    await sendEmail({ to: user.email, ...emailContent });
    res.json({ success: true, message: "Verification email sent" });
  } catch {
    res.status(500).json({ error: "Failed to send verification email. Please try again later." });
  }
});

// T1: Forgot password — send reset email
router.post("/portal/auth/forgot-password", async (req, res): Promise<void> => {
  const email = req.body?.email;
  if (!email || typeof email !== "string") {
    res.status(400).json({ error: "Email is required" });
    return;
  }

  // Always return the same response to prevent email enumeration
  const genericResponse = { success: true, message: "If that email exists, a reset link has been sent." };

  const [user] = await db
    .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, isActive: usersTable.isActive })
    .from(usersTable)
    .where(eq(usersTable.email, email.toLowerCase().trim()))
    .limit(1);

  if (!user || !user.isActive) {
    res.json(genericResponse);
    return;
  }

  const resetToken = generateVerificationToken();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  await db
    .update(usersTable)
    .set({ passwordResetToken: resetToken, passwordResetTokenExpiresAt: expiresAt })
    .where(eq(usersTable.id, user.id));

  const appBaseUrl = await getAppBaseUrl(req);
  const emailContent = buildPasswordResetEmail(user.name, resetToken, appBaseUrl);

  sendEmail({ to: user.email, ...emailContent }).catch((err) => {
    logger.warn({ err, email: user.email }, "Failed to send password reset email");
  });

  res.json(genericResponse);
});

// T1: Reset password with token
router.post("/portal/auth/reset-password", async (req, res): Promise<void> => {
  const { token, password } = req.body ?? {};

  if (!token || typeof token !== "string") {
    res.status(400).json({ error: "Reset token is required" });
    return;
  }
  if (!password || typeof password !== "string" || password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }

  const [user] = await db
    .select({
      id: usersTable.id,
      passwordResetToken: usersTable.passwordResetToken,
      passwordResetTokenExpiresAt: usersTable.passwordResetTokenExpiresAt,
    })
    .from(usersTable)
    .where(eq(usersTable.passwordResetToken, token))
    .limit(1);

  if (!user) {
    res.status(400).json({ error: "Invalid or expired reset token" });
    return;
  }

  if (!user.passwordResetTokenExpiresAt || user.passwordResetTokenExpiresAt < new Date()) {
    res.status(400).json({ error: "Reset token has expired. Please request a new one." });
    return;
  }

  const passwordHash = await hashPassword(password);

  await db
    .update(usersTable)
    .set({
      passwordHash,
      passwordResetToken: null,
      passwordResetTokenExpiresAt: null,
    })
    .where(eq(usersTable.id, user.id));

  res.json({ success: true, message: "Password reset successfully. You can now log in." });
});

// T4: Delete account — soft delete (anonymize) then hard delete all keys
router.delete("/portal/auth/account", requireAuth, async (req, res): Promise<void> => {
  const userId = Number(req.authUser!.sub);

  const { password } = req.body ?? {};
  if (!password || typeof password !== "string") {
    res.status(400).json({ error: "Password confirmation is required" });
    return;
  }

  const [user] = await db
    .select({ id: usersTable.id, passwordHash: usersTable.passwordHash, email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Incorrect password" });
    return;
  }

  await db.transaction(async (tx) => {
    // Revoke all API keys
    await tx.update(apiKeysTable)
      .set({ isActive: false })
      .where(eq(apiKeysTable.userId, userId));

    // Anonymize and deactivate account
    await tx.update(usersTable)
      .set({
        isActive: false,
        email: `deleted_${userId}_${Date.now()}@deleted.invalid`,
        name: "[Deleted Account]",
        passwordHash: "",
        emailVerificationToken: null,
        emailVerificationTokenExpiresAt: null,
        passwordResetToken: null,
        passwordResetTokenExpiresAt: null,
      })
      .where(eq(usersTable.id, userId));
  });

  res.json({ success: true, message: "Account deleted successfully" });
});

router.post("/portal/auth/logout", (_req, res): void => {
  res.clearCookie(COOKIE_NAME, { path: "/" });
  res.json({ success: true, message: "Logged out" });
});

export default router;
