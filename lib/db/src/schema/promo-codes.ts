import { pgTable, serial, text, integer, boolean, timestamp, numeric, index, unique } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const promoCodesTable = pgTable("promo_codes", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  creditsAmount: numeric("credits_amount", { precision: 18, scale: 8, mode: "number" }).notNull(),
  maxUses: integer("max_uses").notNull().default(1),
  usedCount: integer("used_count").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  isActive: boolean("is_active").notNull().default(true),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("promo_codes_code_idx").on(table.code),
  index("promo_codes_is_active_idx").on(table.isActive),
]);

export const promoCodeUsesTable = pgTable("promo_code_uses", {
  id: serial("id").primaryKey(),
  promoCodeId: integer("promo_code_id").notNull().references(() => promoCodesTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  redeemedAt: timestamp("redeemed_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("promo_code_uses_unique").on(table.promoCodeId, table.userId),
  index("promo_code_uses_user_idx").on(table.userId),
]);

export type PromoCode = typeof promoCodesTable.$inferSelect;
export type PromoCodeUse = typeof promoCodeUsesTable.$inferSelect;
