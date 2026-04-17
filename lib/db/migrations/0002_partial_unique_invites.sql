-- Replace blanket unique constraint on invites with a partial unique index
-- so accepted invites (history) don't block re-invites.
ALTER TABLE "organization_invites" DROP CONSTRAINT IF EXISTS "org_invites_unique_pending";
DROP INDEX IF EXISTS "org_invites_unique_pending";
CREATE UNIQUE INDEX "org_invites_unique_pending"
  ON "organization_invites" ("organization_id", "email")
  WHERE "accepted_at" IS NULL;
