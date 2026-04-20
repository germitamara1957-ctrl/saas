import { getSettingValue } from "../routes/admin/settings";

export const SIGNUP_ALLOWED_DOMAINS_KEY = "signup_allowed_email_domains";
export const SIGNUP_BLOCKED_DOMAINS_KEY = "signup_blocked_email_domains";
export const SIGNUP_BLOCK_DISPOSABLE_KEY = "signup_block_disposable";
export const SIGNUP_OFFICIAL_ONLY_KEY = "signup_official_providers_only";

/**
 * Built-in list of mainstream email providers. When "official providers only"
 * mode is enabled, signup is restricted to these domains plus any custom
 * allowlist domains the admin has configured.
 */
export const OFFICIAL_PROVIDERS: ReadonlySet<string> = new Set<string>([
  // Google
  "gmail.com", "googlemail.com",
  // Microsoft
  "outlook.com", "hotmail.com", "live.com", "msn.com",
  "outlook.sa", "outlook.fr", "outlook.de", "outlook.es", "outlook.it",
  "hotmail.fr", "hotmail.co.uk", "hotmail.de", "hotmail.es", "hotmail.it",
  // Yahoo
  "yahoo.com", "yahoo.co.uk", "yahoo.fr", "yahoo.de", "yahoo.es",
  "yahoo.it", "yahoo.ca", "yahoo.com.au", "ymail.com", "rocketmail.com",
  // Apple
  "icloud.com", "me.com", "mac.com",
  // Privacy-focused
  "proton.me", "protonmail.com", "pm.me", "tutanota.com", "tuta.io",
  // AOL / Verizon
  "aol.com",
  // GMX / Mail.com
  "gmx.com", "gmx.net", "gmx.de", "gmx.fr", "mail.com",
  // Zoho
  "zoho.com", "zohomail.com",
  // Yandex (Russia)
  "yandex.com", "yandex.ru",
  // Algeria / MENA ISPs commonly used as personal email
  "algerietelecom.dz",
]);

const DISPOSABLE_DOMAINS = new Set<string>([
  "mailinator.com", "guerrillamail.com", "guerrillamail.net", "guerrillamail.org",
  "guerrillamail.biz", "guerrillamailblock.com", "sharklasers.com", "grr.la",
  "10minutemail.com", "10minutemail.net", "10minutemail.org", "tempmail.com",
  "tempmail.net", "temp-mail.org", "temp-mail.io", "tempmail.io", "tempmailo.com",
  "yopmail.com", "yopmail.net", "yopmail.fr", "trashmail.com", "trashmail.net",
  "trashmail.de", "throwawaymail.com", "fakeinbox.com", "fakemail.fr",
  "mailcatch.com", "mailnesia.com", "mailtemp.info", "maildrop.cc",
  "getnada.com", "nada.email", "dispostable.com", "spambox.us",
  "mintemail.com", "mohmal.com", "mvrht.com", "spam4.me", "incognitomail.com",
  "discard.email", "discardmail.com", "33mail.com", "anonbox.net",
  "byom.de", "harakirimail.com", "jetable.org", "moakt.com", "moakt.cc",
  "mt2015.com", "mytemp.email", "noclickemail.com", "owlymail.com",
  "punkass.com", "spamgourmet.com", "spamfree24.org", "tempinbox.com",
  "tempmailaddress.com", "thrott.com", "tmpmail.org", "tmpmail.net",
  "tmpeml.com", "yepmail.net", "throwam.com", "burnermail.io",
  "emailondeck.com", "minutemail.com", "mailforspam.com", "anonymbox.com",
  "deadaddress.com", "explodemail.com", "instaaddr.com", "armyspy.com",
  "cuvox.de", "dayrep.com", "einrot.com", "fleckens.hu", "gustr.com",
  "jourrapide.com", "rhyta.com", "superrito.com", "teleworm.us",
  "tempmail.plus", "1secmail.com", "1secmail.net", "1secmail.org",
  "moakt.ws", "kasmail.com", "vusra.com", "tafmail.com", "linshiyou.com",
]);

interface EmailPolicy {
  allowedDomains: Set<string> | null; // null = no allowlist (open registration)
  blockedDomains: Set<string>;
  blockDisposable: boolean;
  officialOnly: boolean;
}

let cache: { value: EmailPolicy; expiresAt: number } | null = null;
const CACHE_TTL_MS = 60_000;

export function invalidateEmailPolicyCache(): void {
  cache = null;
}

function parseCsvDomains(raw: string | null): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(/[,\s\n]+/)
      .map((d) => d.trim().toLowerCase())
      .filter((d) => d.length > 0 && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)),
  );
}

export async function getEmailPolicy(): Promise<EmailPolicy> {
  if (cache && cache.expiresAt > Date.now()) return cache.value;
  const [allowedRaw, blockedRaw, blockDispRaw, officialOnlyRaw] = await Promise.all([
    getSettingValue(SIGNUP_ALLOWED_DOMAINS_KEY),
    getSettingValue(SIGNUP_BLOCKED_DOMAINS_KEY),
    getSettingValue(SIGNUP_BLOCK_DISPOSABLE_KEY),
    getSettingValue(SIGNUP_OFFICIAL_ONLY_KEY),
  ]);
  const allowed = parseCsvDomains(allowedRaw);
  const value: EmailPolicy = {
    allowedDomains: allowed.size > 0 ? allowed : null,
    blockedDomains: parseCsvDomains(blockedRaw),
    // Default: block disposable emails unless explicitly disabled.
    blockDisposable: blockDispRaw == null ? true : blockDispRaw !== "false",
    // Default: restrict to official providers unless explicitly disabled.
    officialOnly: officialOnlyRaw == null ? true : officialOnlyRaw !== "false",
  };
  cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

export interface EmailValidationResult {
  ok: boolean;
  reason?: string;
  reasonAr?: string;
}

/**
 * Validates a signup email against the configured allowlist, blocklist, and
 * built-in disposable email blocklist. Returns localized rejection reasons.
 */
export async function validateSignupEmail(email: string): Promise<EmailValidationResult> {
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf("@");
  if (at < 1 || at === normalized.length - 1) {
    return { ok: false, reason: "Invalid email address", reasonAr: "بريد إلكتروني غير صالح" };
  }
  const domain = normalized.slice(at + 1);

  const policy = await getEmailPolicy();

  if (policy.blockedDomains.has(domain)) {
    return {
      ok: false,
      reason: "This email domain is not allowed for registration.",
      reasonAr: "نطاق البريد هذا غير مسموح بالتسجيل به.",
    };
  }

  if (policy.blockDisposable && DISPOSABLE_DOMAINS.has(domain)) {
    return {
      ok: false,
      reason: "Disposable / temporary email addresses are not allowed. Please use a real email.",
      reasonAr: "البريد المؤقّت غير مسموح. الرجاء استخدام بريد إلكتروني حقيقي.",
    };
  }

  // Effective allowlist combines the built-in OFFICIAL_PROVIDERS (when
  // officialOnly mode is on) with any admin-configured custom domains.
  let effectiveAllow: Set<string> | null = null;
  if (policy.officialOnly && policy.allowedDomains) {
    effectiveAllow = new Set([...OFFICIAL_PROVIDERS, ...policy.allowedDomains]);
  } else if (policy.officialOnly) {
    effectiveAllow = new Set(OFFICIAL_PROVIDERS);
  } else if (policy.allowedDomains) {
    effectiveAllow = policy.allowedDomains;
  }

  if (effectiveAllow && !effectiveAllow.has(domain)) {
    return {
      ok: false,
      reason: "Only official email providers (Gmail, Outlook, Yahoo, iCloud, etc.) are allowed for registration.",
      reasonAr: "يُقبل التسجيل فقط من مزودي البريد الرسميين (Gmail, Outlook, Yahoo, iCloud وغيرها).",
    };
  }

  return { ok: true };
}
