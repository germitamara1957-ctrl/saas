import { pgTable, serial, text, integer, timestamp, numeric, primaryKey, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";

export const organizationsTable = pgTable("organizations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  ownerId: integer("owner_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  creditBalance: numeric("credit_balance", { precision: 18, scale: 8, mode: "number" }).notNull().default(0),
  topupCreditBalance: numeric("topup_credit_balance", { precision: 18, scale: 8, mode: "number" }).notNull().default(0),
  // Optional org-level spend caps. NULL = no cap. Independent from per-user/per-key caps.
  dailySpendLimitUsd: numeric("daily_spend_limit_usd", { precision: 18, scale: 8, mode: "number" }),
  monthlySpendLimitUsd: numeric("monthly_spend_limit_usd", { precision: 18, scale: 8, mode: "number" }),
  // Subscription period window (parallel to users). When `current_period_end`
  // is in the past the org's `creditBalance` (subscription credit) cannot be
  // used for plan-exclusive models — only `topupCreditBalance` works.
  currentPeriodStartedAt: timestamp("current_period_started_at", { withTimezone: true }),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("organizations_owner_idx").on(t.ownerId),
]);

export const organizationMembersTable = pgTable("organization_members", {
  organizationId: integer("organization_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("developer"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.organizationId, t.userId] }),
  index("org_members_user_idx").on(t.userId),
]);

export const organizationInvitesTable = pgTable("organization_invites", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role").notNull().default("developer"),
  token: text("token").notNull().unique(),
  invitedById: integer("invited_by_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // Partial unique: only one *pending* invite per (org, email).
  // Accepted invites (acceptedAt IS NOT NULL) are kept as history and don't block re-invites.
  uniqueIndex("org_invites_unique_pending").on(t.organizationId, t.email).where(sql`accepted_at IS NULL`),
  index("org_invites_token_idx").on(t.token),
  index("org_invites_email_idx").on(t.email),
]);

export type Organization = typeof organizationsTable.$inferSelect;
export type OrganizationMember = typeof organizationMembersTable.$inferSelect;
export type OrganizationInvite = typeof organizationInvitesTable.$inferSelect;
