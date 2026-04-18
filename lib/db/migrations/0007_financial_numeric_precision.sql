-- Convert all financial USD/credit columns from `double precision` to
-- `numeric(18, 8)` to eliminate floating-point drift in monetary arithmetic
-- on the database side. Application layer continues to read these as JS
-- numbers (drizzle `mode: "number"`), so no application code change is needed.
--
-- Columns that are intentionally LEFT as `double precision`:
--   - users.spend_alert_threshold  (ratio 0..1, not money)
--   - rate_limit_buckets_v2.tokens (token-bucket counter, not money)

-- users
ALTER TABLE "users"
  ALTER COLUMN "credit_balance"        TYPE numeric(18, 8) USING "credit_balance"::numeric(18, 8),
  ALTER COLUMN "topup_credit_balance"  TYPE numeric(18, 8) USING "topup_credit_balance"::numeric(18, 8),
  ALTER COLUMN "daily_spend_limit_usd" TYPE numeric(18, 8) USING "daily_spend_limit_usd"::numeric(18, 8),
  ALTER COLUMN "monthly_spend_limit_usd" TYPE numeric(18, 8) USING "monthly_spend_limit_usd"::numeric(18, 8);

-- organizations
ALTER TABLE "organizations"
  ALTER COLUMN "credit_balance"          TYPE numeric(18, 8) USING "credit_balance"::numeric(18, 8),
  ALTER COLUMN "topup_credit_balance"    TYPE numeric(18, 8) USING "topup_credit_balance"::numeric(18, 8),
  ALTER COLUMN "daily_spend_limit_usd"   TYPE numeric(18, 8) USING "daily_spend_limit_usd"::numeric(18, 8),
  ALTER COLUMN "monthly_spend_limit_usd" TYPE numeric(18, 8) USING "monthly_spend_limit_usd"::numeric(18, 8);

-- plans
ALTER TABLE "plans"
  ALTER COLUMN "monthly_credits" TYPE numeric(18, 8) USING "monthly_credits"::numeric(18, 8),
  ALTER COLUMN "price_usd"       TYPE numeric(18, 8) USING "price_usd"::numeric(18, 8);

-- usage_logs
ALTER TABLE "usage_logs"
  ALTER COLUMN "cost_usd" TYPE numeric(18, 8) USING "cost_usd"::numeric(18, 8);

-- model_costs
ALTER TABLE "model_costs"
  ALTER COLUMN "input_per_1m"  TYPE numeric(18, 8) USING "input_per_1m"::numeric(18, 8),
  ALTER COLUMN "output_per_1m" TYPE numeric(18, 8) USING "output_per_1m"::numeric(18, 8),
  ALTER COLUMN "per_image"     TYPE numeric(18, 8) USING "per_image"::numeric(18, 8),
  ALTER COLUMN "per_second"    TYPE numeric(18, 8) USING "per_second"::numeric(18, 8);

-- api_keys
ALTER TABLE "api_keys"
  ALTER COLUMN "credit_balance"          TYPE numeric(18, 8) USING "credit_balance"::numeric(18, 8),
  ALTER COLUMN "monthly_spend_limit_usd" TYPE numeric(18, 8) USING "monthly_spend_limit_usd"::numeric(18, 8);

-- promo_codes
ALTER TABLE "promo_codes"
  ALTER COLUMN "credits_amount" TYPE numeric(18, 8) USING "credits_amount"::numeric(18, 8);
