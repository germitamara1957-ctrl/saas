import { pgTable, serial, integer, text, timestamp, numeric, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

/**
 * Referral commission earnings — Phase 1.
 *
 * Each row represents commission owed to `referrerId` for revenue generated
 * by `referredUserId`. The `basisAmountUsd` is the ACTUAL money paid by the
 * referee (e.g. plan price $29 or top-up USD value), NOT the credit value
 * granted. Commission = basisAmountUsd * referral_rate (system_settings).
 *
 * Lifecycle:
 *   pending  → created on payment success; held for `referral_hold_days`
 *              (default 14) to allow refunds/disputes.
 *   available → after the hold window, eligible for redemption to topup
 *              credit balance.
 *   redeemed  → user has converted to topupCreditBalance.
 *   reversed  → original payment was refunded/disputed; commission removed.
 */
export const referralEarningsTable = pgTable("referral_earnings", {
  id: serial("id").primaryKey(),
  referrerId: integer("referrer_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  referredUserId: integer("referred_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  // 'topup' | 'plan'
  sourceType: text("source_type").notNull(),
  // FK is loose (text) because source can be payment_intents.id OR a plan
  // enrollment marker; we store as text with sourceType discriminator.
  sourceId: text("source_id").notNull(),
  basisAmountUsd: numeric("basis_amount_usd", { precision: 18, scale: 8, mode: "number" }).notNull(),
  commissionUsd: numeric("commission_usd", { precision: 18, scale: 8, mode: "number" }).notNull(),
  rate: numeric("rate", { precision: 6, scale: 4, mode: "number" }).notNull(),
  // 'pending' | 'available' | 'redeemed' | 'reversed'
  status: text("status").notNull().default("pending"),
  unlocksAt: timestamp("unlocks_at", { withTimezone: true }).notNull(),
  redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("referral_earnings_referrer_id_idx").on(table.referrerId),
  index("referral_earnings_referred_user_id_idx").on(table.referredUserId),
  index("referral_earnings_status_idx").on(table.status),
  index("referral_earnings_unlocks_at_idx").on(table.unlocksAt),
  // DB-enforced idempotency: at most one earning row per (source_type, source_id).
  // This is the safety net against concurrent webhook deliveries.
  uniqueIndex("referral_earnings_source_uidx").on(table.sourceType, table.sourceId),
]);

export const insertReferralEarningSchema = createInsertSchema(referralEarningsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertReferralEarning = z.infer<typeof insertReferralEarningSchema>;
export type ReferralEarning = typeof referralEarningsTable.$inferSelect;
