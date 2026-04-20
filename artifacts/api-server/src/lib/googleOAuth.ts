import { getSettingValue } from "../routes/admin/settings";
import { logger } from "./logger";

export interface GoogleOAuthConfig {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
}

let cache: { value: GoogleOAuthConfig; expiresAt: number } | null = null;
const CACHE_TTL_MS = 60_000;

export function invalidateGoogleOAuthCache(): void {
  cache = null;
}

function parseBool(v: string | null): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes";
}

export async function getGoogleOAuthConfig(): Promise<GoogleOAuthConfig> {
  if (cache && cache.expiresAt > Date.now()) return cache.value;

  const [enabledRaw, clientId, clientSecret] = await Promise.all([
    getSettingValue("google_oauth_enabled").catch(() => null),
    getSettingValue("google_oauth_client_id").catch(() => null),
    getSettingValue("google_oauth_client_secret").catch(() => null),
  ]);

  const value: GoogleOAuthConfig = {
    enabled: parseBool(enabledRaw) && Boolean(clientId) && Boolean(clientSecret),
    clientId: clientId ?? "",
    clientSecret: clientSecret ?? "",
  };

  cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

export interface GoogleUserInfo {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
}

export async function exchangeCodeForUserInfo(params: {
  code: string;
  redirectUri: string;
}): Promise<GoogleUserInfo> {
  const cfg = await getGoogleOAuthConfig();
  if (!cfg.enabled) throw new Error("Google sign-in is not configured");

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: params.code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: params.redirectUri,
      grant_type: "authorization_code",
    }).toString(),
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text().catch(() => "");
    logger.warn({ status: tokenRes.status, body: text.slice(0, 500) }, "Google token exchange failed");
    throw new Error("Failed to exchange Google authorization code");
  }

  const tokenJson = (await tokenRes.json()) as { access_token?: string; id_token?: string };
  if (!tokenJson.access_token) throw new Error("Google did not return an access token");

  const userRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
  });
  if (!userRes.ok) {
    const text = await userRes.text().catch(() => "");
    logger.warn({ status: userRes.status, body: text.slice(0, 500) }, "Google userinfo fetch failed");
    throw new Error("Failed to fetch Google user profile");
  }

  const u = (await userRes.json()) as {
    sub?: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
    given_name?: string;
    family_name?: string;
  };

  if (!u.sub || !u.email) throw new Error("Google profile is missing required fields");

  return {
    sub: u.sub,
    email: u.email.toLowerCase().trim(),
    emailVerified: u.email_verified !== false,
    name: u.name || [u.given_name, u.family_name].filter(Boolean).join(" ") || u.email,
  };
}

export function buildGoogleAuthUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", params.state);
  url.searchParams.set("access_type", "online");
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}
