-- Status Page: incidents + uptime snapshots
CREATE TABLE "incidents" (
        "id" serial PRIMARY KEY NOT NULL,
        "title_en" text NOT NULL,
        "title_ar" text NOT NULL,
        "body_en" text DEFAULT '' NOT NULL,
        "body_ar" text DEFAULT '' NOT NULL,
        "status" text DEFAULT 'investigating' NOT NULL,
        "severity" text DEFAULT 'minor' NOT NULL,
        "started_at" timestamp with time zone DEFAULT now() NOT NULL,
        "resolved_at" timestamp with time zone,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "incidents_started_at_idx" ON "incidents" ("started_at");
--> statement-breakpoint
CREATE INDEX "incidents_resolved_at_idx" ON "incidents" ("resolved_at");
--> statement-breakpoint

CREATE TABLE "health_snapshots" (
        "id" serial PRIMARY KEY NOT NULL,
        "ok" boolean NOT NULL,
        "latency_ms" integer DEFAULT 0 NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "health_snapshots_created_at_idx" ON "health_snapshots" ("created_at");
--> statement-breakpoint

-- Organizations / Teams
CREATE TABLE "organizations" (
        "id" serial PRIMARY KEY NOT NULL,
        "name" text NOT NULL,
        "slug" text NOT NULL UNIQUE,
        "owner_id" integer NOT NULL,
        "credit_balance" double precision DEFAULT 0 NOT NULL,
        "topup_credit_balance" double precision DEFAULT 0 NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX "organizations_owner_idx" ON "organizations" ("owner_id");
--> statement-breakpoint

CREATE TABLE "organization_members" (
        "organization_id" integer NOT NULL,
        "user_id" integer NOT NULL,
        "role" text DEFAULT 'developer' NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        CONSTRAINT "organization_members_pkey" PRIMARY KEY ("organization_id", "user_id")
);
--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_org_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX "org_members_user_idx" ON "organization_members" ("user_id");
--> statement-breakpoint

CREATE TABLE "organization_invites" (
        "id" serial PRIMARY KEY NOT NULL,
        "organization_id" integer NOT NULL,
        "email" text NOT NULL,
        "role" text DEFAULT 'developer' NOT NULL,
        "token" text NOT NULL UNIQUE,
        "invited_by_id" integer NOT NULL,
        "accepted_at" timestamp with time zone,
        "expires_at" timestamp with time zone NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization_invites" ADD CONSTRAINT "organization_invites_org_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "organization_invites" ADD CONSTRAINT "organization_invites_invited_by_fk" FOREIGN KEY ("invited_by_id") REFERENCES "users"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "organization_invites" ADD CONSTRAINT "org_invites_unique_pending" UNIQUE ("organization_id", "email");
--> statement-breakpoint
CREATE INDEX "org_invites_token_idx" ON "organization_invites" ("token");
--> statement-breakpoint
CREATE INDEX "org_invites_email_idx" ON "organization_invites" ("email");
--> statement-breakpoint

-- Optional org link on api_keys (nullable, no FK to keep existing constraint surface stable)
ALTER TABLE "api_keys" ADD COLUMN "organization_id" integer;
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_org_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE set null;
--> statement-breakpoint
CREATE INDEX "api_keys_org_id_idx" ON "api_keys" ("organization_id");
