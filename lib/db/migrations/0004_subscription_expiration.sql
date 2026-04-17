ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "current_period_started_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "current_period_end" timestamptz;

ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "current_period_started_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "current_period_end" timestamptz;

CREATE INDEX IF NOT EXISTS "users_current_period_end_idx"
  ON "users" ("current_period_end")
  WHERE "current_period_end" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "organizations_current_period_end_idx"
  ON "organizations" ("current_period_end")
  WHERE "current_period_end" IS NOT NULL;

UPDATE "users"
SET "current_period_started_at" = now(),
    "current_period_end" = now() + interval '30 days'
WHERE "current_plan_id" IS NOT NULL
  AND "current_period_end" IS NULL;

UPDATE "organizations"
SET "current_period_started_at" = now(),
    "current_period_end" = now() + interval '30 days'
WHERE "current_period_end" IS NULL;
