-- Org-billing wiring: stamp usage_logs with org id, and add per-org spend caps.
ALTER TABLE "usage_logs" ADD COLUMN IF NOT EXISTS "organization_id" integer;
CREATE INDEX IF NOT EXISTS "usage_logs_org_id_idx" ON "usage_logs" ("organization_id");
CREATE INDEX IF NOT EXISTS "usage_logs_org_created_idx" ON "usage_logs" ("organization_id", "created_at");

ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "daily_spend_limit_usd" double precision;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "monthly_spend_limit_usd" double precision;
