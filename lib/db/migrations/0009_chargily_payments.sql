-- Chargily Pay V2 integration: top-up payment intents + webhook event log.
-- Status: pending → paid | failed | canceled | expired. Credit happens
-- exactly once via a CAS UPDATE in the webhook handler.

CREATE TABLE IF NOT EXISTS "payment_intents" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "organization_id" integer REFERENCES "organizations"("id") ON DELETE SET NULL,
  "chargily_checkout_id" text NOT NULL,
  "chargily_customer_id" text,
  "amount_dzd" numeric(18, 2) NOT NULL,
  "amount_usd" numeric(18, 8) NOT NULL,
  "exchange_rate" numeric(18, 8) NOT NULL,
  "currency" text NOT NULL DEFAULT 'dzd',
  "status" text NOT NULL DEFAULT 'pending',
  "mode" text NOT NULL DEFAULT 'test',
  "checkout_url" text,
  "webhook_received_at" timestamp with time zone,
  "credited_at" timestamp with time zone,
  "failure_reason" text,
  "metadata" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "payment_intents_chargily_checkout_id_uidx"
  ON "payment_intents" ("chargily_checkout_id");
CREATE INDEX IF NOT EXISTS "payment_intents_user_id_idx" ON "payment_intents" ("user_id");
CREATE INDEX IF NOT EXISTS "payment_intents_status_idx" ON "payment_intents" ("status");
CREATE INDEX IF NOT EXISTS "payment_intents_created_at_idx" ON "payment_intents" ("created_at");

CREATE TABLE IF NOT EXISTS "chargily_webhook_events" (
  "id" serial PRIMARY KEY,
  "event_id" text NOT NULL,
  "event_type" text NOT NULL,
  "signature" text NOT NULL,
  "payload" text NOT NULL,
  "processed_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "chargily_webhook_events_event_id_uidx"
  ON "chargily_webhook_events" ("event_id");
CREATE INDEX IF NOT EXISTS "chargily_webhook_events_processed_at_idx"
  ON "chargily_webhook_events" ("processed_at");

-- System settings defaults for Chargily. Values are stored as text and
-- parsed at runtime. Admins can edit these via /admin/settings.
INSERT INTO "system_settings" ("key", "value", "encrypted")
VALUES
  ('chargily_dzd_to_usd_rate', '135', false),
  ('chargily_min_topup_dzd', '500', false),
  ('chargily_max_topup_dzd', '500000', false)
ON CONFLICT ("key") DO NOTHING;
