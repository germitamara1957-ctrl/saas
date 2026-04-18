-- Add foreign key constraints + missing indexes for organization columns
-- and request-id lookups. Refunds and analytics rely on these.

-- Foreign keys (set null on org delete so historical logs survive).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'api_keys_organization_id_fkey'
  ) THEN
    ALTER TABLE "api_keys"
      ADD CONSTRAINT "api_keys_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'usage_logs_organization_id_fkey'
  ) THEN
    ALTER TABLE "usage_logs"
      ADD CONSTRAINT "usage_logs_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

-- Indexes (idempotent).
CREATE INDEX IF NOT EXISTS "api_keys_organization_id_idx" ON "api_keys" ("organization_id");
CREATE INDEX IF NOT EXISTS "usage_logs_request_id_idx" ON "usage_logs" ("request_id");
