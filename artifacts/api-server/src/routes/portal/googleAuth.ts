import { Router, type IRouter, type Request, type Response } from "express";
import { eq, asc } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { db, usersTable, apiKeysTable, plansTable } from "@workspace/db";
import { logger } from "../../lib/logger";
import { signToken } from "../../lib/jwt";
import { generateApiKey, encryptApiKey } from "../../lib/crypto";
import { withDbRetry } from "../../lib/dbRetry";
import { getSettingValue } from "../admin/settings";
import {
  getGoogleOAuthConfig,
  buildGoogleAuthUrl,
  exchangeCodeForUserInfo,
} from "../../lib/googleOAuth";
import { checkRegistrationLimit } from "../../lib/ipRateLimit";

function getClientIp(req: Request): string {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) {
    return xff.split(",")[0]!.trim();
  }
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

const router: IRouter = Router();

const COOKIE_NAME = "auth_token";
const STATE_COOKIE = "g_oauth_state";

function setAuthCookie(res: Response, token: string): void {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

async function getAppBaseUrl(req: Request): Promise<string> {
  const override = await getSettingValue("app_base_url").catch(() => null);
  if (override) return override.replace(/\/$/, "");
  const proto = (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim() ?? req.protocol;
  const host = (req.headers["x-forwarded-host"] as string | undefined)?.split(",")[0]?.trim() ?? req.hostname;
  return `${proto}://${host}`;
}

function getRedirectUri(baseUrl: string): string {
  return `${baseUrl}/api/portal/auth/google/callback`;
}

// Public: tells the frontend whether to render the "Continue with Google" button.
router.get("/portal/auth/google/config", async (_req, res): Promise<void> => {
  try {
    const cfg = await getGoogleOAuthConfig();
    res.json({ enabled: cfg.enabled });
  } catch (err) {
    logger.warn({ err }, "google/config failed");
    res.json({ enabled: false });
  }
});

// Admin: returns the redirect URI to copy into Google Cloud Console.
router.get("/portal/auth/google/redirect-uri", async (req, res): Promise<void> => {
  const baseUrl = await getAppBaseUrl(req);
  res.json({ redirectUri: getRedirectUri(baseUrl) });
});

// Step 1: redirect the user to Google's consent screen.
router.get("/portal/auth/google", async (req, res): Promise<void> => {
  try {
    const cfg = await getGoogleOAuthConfig();
    if (!cfg.enabled) {
      res.status(404).send("Google sign-in is not enabled");
      return;
    }

    const baseUrl = await getAppBaseUrl(req);
    const redirectUri = getRedirectUri(baseUrl);

    // CSRF state — random 32-byte token mirrored in cookie + URL.
    // Optionally carries the referral code for new signups.
    const csrf = randomBytes(24).toString("hex");
    const refCode = typeof req.query?.ref === "string" ? req.query.ref.slice(0, 32) : "";
    const statePayload = JSON.stringify({ c: csrf, r: refCode });
    const state = Buffer.from(statePayload, "utf8").toString("base64url");

    res.cookie(STATE_COOKIE, csrf, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 10 * 60 * 1000,
      path: "/",
    });

    const authUrl = buildGoogleAuthUrl({
      clientId: cfg.clientId,
      redirectUri,
      state,
    });
    res.redirect(authUrl);
  } catch (err) {
    logger.error({ err }, "google authorize failed");
    res.status(500).send("Google sign-in failed to start");
  }
});

// Step 2: callback from Google — exchange code, find/create user, set auth cookie.
router.get("/portal/auth/google/callback", async (req, res): Promise<void> => {
  const baseUrl = await getAppBaseUrl(req);
  // Use a path-only redirect for failures to eliminate any open-redirect risk
  // from spoofed X-Forwarded-Host headers. The browser stays on the same origin.
  const fail = (reason: string) =>
    res.redirect(`/login?google=error&reason=${encodeURIComponent(reason)}`);

  try {
    const code = typeof req.query?.code === "string" ? req.query.code : "";
    const stateRaw = typeof req.query?.state === "string" ? req.query.state : "";
    const errorParam = typeof req.query?.error === "string" ? req.query.error : "";

    if (errorParam) {
      logger.info({ error: errorParam }, "Google returned an error");
      return fail(errorParam === "access_denied" ? "cancelled" : "google_error");
    }
    if (!code || !stateRaw) return fail("missing_params");

    // Verify CSRF state matches the cookie.
    const stateCookie = (req.cookies?.[STATE_COOKIE] as string | undefined) ?? "";
    res.clearCookie(STATE_COOKIE, { path: "/" });

    let parsedState: { c?: string; r?: string };
    try {
      parsedState = JSON.parse(Buffer.from(stateRaw, "base64url").toString("utf8")) as {
        c?: string;
        r?: string;
      };
    } catch {
      return fail("bad_state");
    }
    if (!parsedState.c || parsedState.c !== stateCookie) return fail("state_mismatch");

    const refCode = (parsedState.r ?? "").trim() || null;
    const redirectUri = getRedirectUri(baseUrl);

    const profile = await exchangeCodeForUserInfo({ code, redirectUri });
    if (!profile.emailVerified) return fail("email_not_verified");

    // Look up by googleId first, then by email (account linking).
    const [byGoogleId] = await withDbRetry(
      () =>
        db
          .select()
          .from(usersTable)
          .where(eq(usersTable.googleId, profile.sub))
          .limit(1),
      { label: "google.findByGoogleId" },
    );

    let user = byGoogleId ?? null;

    if (!user) {
      const [byEmail] = await withDbRetry(
        () =>
          db
            .select()
            .from(usersTable)
            .where(eq(usersTable.email, profile.email))
            .limit(1),
        { label: "google.findByEmail" },
      );

      if (byEmail) {
        // Link existing account to this Google identity — but ONLY if the
        // existing account has already proven control of the email (either
        // verified, or it has no password meaning it was OAuth-only itself).
        // This prevents a pre-auth account-takeover where an attacker creates
        // an unverified account using the victim's email, then waits for the
        // victim to sign in with Google.
        if (!byEmail.isActive) return fail("account_disabled");
        if (byEmail.passwordHash && !byEmail.emailVerified) {
          return fail("link_blocked_unverified");
        }
        const [updated] = await db
          .update(usersTable)
          .set({
            googleId: profile.sub,
            emailVerified: true,
            emailVerificationToken: null,
            emailVerificationTokenExpiresAt: null,
          })
          .where(eq(usersTable.id, byEmail.id))
          .returning();
        user = updated!;
      } else {
        // Brand-new user — enforce per-IP signup limit (same as password signup)
        // to prevent automated multi-account creation via Google OAuth.
        const ip = getClientIp(req);
        const limit = await checkRegistrationLimit(ip);
        if (!limit.allowed) {
          logger.warn({ ip }, "Google signup blocked by per-IP rate limit");
          return fail("too_many_signups");
        }

        // Create account + provision starter API key like the password signup
        // flow. Google email is trusted, so emailVerified=true.
        const [freePlan] = await db
          .select()
          .from(plansTable)
          .where(eq(plansTable.isActive, true))
          .orderBy(asc(plansTable.priceUsd), asc(plansTable.id))
          .limit(1);

        let createdUser: typeof usersTable.$inferSelect | null = null;
        await db.transaction(async (tx) => {
          const [newUser] = await tx
            .insert(usersTable)
            .values({
              name: profile.name,
              email: profile.email,
              passwordHash: null,
              googleId: profile.sub,
              role: "developer",
              isActive: true,
              creditBalance: freePlan ? freePlan.monthlyCredits : 0,
              emailVerified: true,
            })
            .returning();
          createdUser = newUser!;

          if (freePlan) {
            const { rawKey, keyHash, keyPrefix } = generateApiKey();
            const keyEncrypted = encryptApiKey(rawKey);
            await tx.insert(apiKeysTable).values({
              userId: createdUser.id,
              planId: freePlan.id,
              keyPrefix,
              keyHash,
              keyEncrypted,
              name: "Default Key",
              creditBalance: 0,
              isActive: true,
            });
          }
        });

        user = createdUser!;

        // Capture referral (idempotent, self-validating) — non-fatal.
        if (refCode) {
          try {
            const { captureSignupReferral } = await import("../../lib/referrals");
            await captureSignupReferral(user.id, refCode);
          } catch (err) {
            logger.warn({ err, userId: user.id }, "captureSignupReferral failed (google)");
          }
        }
      }
    }

    if (!user.isActive) return fail("account_disabled");

    const token = signToken({
      sub: String(user.id),
      email: user.email,
      role: user.role,
      name: user.name,
    });
    setAuthCookie(res, token);

    // Land the user in the portal home (path-only — no host injection risk).
    void baseUrl;
    res.redirect(`/portal`);
  } catch (err) {
    logger.error({ err }, "google callback failed");
    return fail("server_error");
  }
});

export default router;
