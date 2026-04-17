-- ── 2FA (TOTP) for users (admin & developers) ───────────────────────────────
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "totp_secret" text,
  ADD COLUMN IF NOT EXISTS "totp_enabled" boolean DEFAULT false NOT NULL;

-- ── Grace-period expiration for rotated API keys ────────────────────────────
ALTER TABLE "api_keys"
  ADD COLUMN IF NOT EXISTS "expires_at" timestamp with time zone;
