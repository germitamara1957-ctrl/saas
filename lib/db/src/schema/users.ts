import { pgTable, serial, text, boolean, timestamp, doublePrecision, numeric, integer, index, varchar, AnyPgColumn } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { plansTable } from "./plans";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull().default("developer"),
  isActive: boolean("is_active").notNull().default(true),
  creditBalance: numeric("credit_balance", { precision: 18, scale: 8, mode: "number" }).notNull().default(0),
  topupCreditBalance: numeric("topup_credit_balance", { precision: 18, scale: 8, mode: "number" }).notNull().default(0),
  emailVerified: boolean("email_verified").notNull().default(false),
  emailVerificationToken: text("email_verification_token"),
  emailVerificationTokenExpiresAt: timestamp("email_verification_token_expires_at", { withTimezone: true }),
  passwordResetToken: text("password_reset_token"),
  passwordResetTokenExpiresAt: timestamp("password_reset_token_expires_at", { withTimezone: true }),
  creditWarningEmailSentAt: timestamp("credit_warning_email_sent_at", { withTimezone: true }),
  currentPlanId: integer("current_plan_id").references(() => plansTable.id, { onDelete: "set null" }),
  // Subscription period window. When `current_period_end` is in the past the
  // subscription is considered EXPIRED — `creditBalance` (subscription credit)
  // becomes unusable for plan-exclusive models, leaving only `topupCreditBalance`.
  currentPeriodStartedAt: timestamp("current_period_started_at", { withTimezone: true }),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  guardrailViolations: integer("guardrail_violations").notNull().default(0),
  guardrailSuspended: boolean("guardrail_suspended").notNull().default(false),
  // ── 2FA (TOTP) — admin accounts only by default, but available to all users.
  // `totpSecret` is AES-256-GCM encrypted using ENCRYPTION_KEY.
  totpSecret: text("totp_secret"),
  totpEnabled: boolean("totp_enabled").notNull().default(false),
  // Spending limits (USD). null = no limit. Threshold is 0..1 (e.g. 0.8 = alert at 80%).
  dailySpendLimitUsd: numeric("daily_spend_limit_usd", { precision: 18, scale: 8, mode: "number" }),
  monthlySpendLimitUsd: numeric("monthly_spend_limit_usd", { precision: 18, scale: 8, mode: "number" }),
  spendAlertThreshold: doublePrecision("spend_alert_threshold").notNull().default(0.8),
  spendAlertEmailSentAt: timestamp("spend_alert_email_sent_at", { withTimezone: true }),
  // Referral system (Phase 1). `referralCode` is the user's own shareable
  // code (8-char base32, generated lazily). `referredBy` is set ONCE at signup
  // when the user arrives via someone else's link, and never changes after.
  referralCode: varchar("referral_code", { length: 16 }).unique(),
  referredBy: integer("referred_by").references((): AnyPgColumn => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("users_is_active_idx").on(table.isActive),
  index("users_role_idx").on(table.role),
  index("users_email_verification_token_idx").on(table.emailVerificationToken),
  index("users_password_reset_token_idx").on(table.passwordResetToken),
  index("users_referred_by_idx").on(table.referredBy),
]);

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
