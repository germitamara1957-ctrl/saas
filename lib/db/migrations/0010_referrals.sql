-- Referral system Phase 1: every user can share a unique code; commission
-- is recorded on real revenue (NOT on credit value granted), held for a
-- configurable window, then redeemable to topupCreditBalance.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "referral_code" varchar(16);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "referred_by" integer
  REFERENCES "users"("id") ON DELETE SET NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_referral_code_unique') THEN
    ALTER TABLE "users" ADD CONSTRAINT "users_referral_code_unique" UNIQUE ("referral_code");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "users_referred_by_idx" ON "users" ("referred_by");

CREATE TABLE IF NOT EXISTS "referral_earnings" (
  "id" serial PRIMARY KEY,
  "referrer_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "referred_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  -- 'topup' | 'plan'
  "source_type" text NOT NULL,
  -- payment_intents.id (as text) or plan enrollment marker; discriminated by source_type
  "source_id" text NOT NULL,
  -- ACTUAL USD revenue (paid by referee), NEVER the credit value granted
  "basis_amount_usd" numeric(18, 8) NOT NULL,
  "commission_usd" numeric(18, 8) NOT NULL,
  "rate" numeric(6, 4) NOT NULL,
  -- 'pending' | 'available' | 'redeemed' | 'reversed'
  "status" text NOT NULL DEFAULT 'pending',
  "unlocks_at" timestamp with time zone NOT NULL,
  "redeemed_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "referral_earnings_referrer_id_idx"      ON "referral_earnings" ("referrer_id");
CREATE INDEX IF NOT EXISTS "referral_earnings_referred_user_id_idx" ON "referral_earnings" ("referred_user_id");
CREATE INDEX IF NOT EXISTS "referral_earnings_status_idx"           ON "referral_earnings" ("status");
CREATE INDEX IF NOT EXISTS "referral_earnings_unlocks_at_idx"       ON "referral_earnings" ("unlocks_at");

-- DB-enforced idempotency: at most one earning per (source_type, source_id).
-- Critical for race-safe webhook processing.
CREATE UNIQUE INDEX IF NOT EXISTS "referral_earnings_source_uidx"
  ON "referral_earnings" ("source_type", "source_id");

-- Defaults — admins can override via /admin/settings.
INSERT INTO "system_settings" ("key", "value", "encrypted") VALUES
  ('referral_rate', '0.08', false),
  ('referral_hold_days', '14', false),
  ('referral_min_redeem_usd', '10', false),
  ('referrals_enabled', 'true', false)
ON CONFLICT ("key") DO NOTHING;
