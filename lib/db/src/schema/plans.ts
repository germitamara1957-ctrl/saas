import { pgTable, serial, text, integer, boolean, timestamp, numeric, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { sql } from "drizzle-orm";

export const plansTable = pgTable("plans", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  monthlyCredits: numeric("monthly_credits", { precision: 18, scale: 8, mode: "number" }).notNull().default(0),
  rpm: integer("rpm").notNull().default(60),
  maxApiKeys: integer("max_api_keys").notNull().default(3),
  maxWebhooks: integer("max_webhooks").notNull().default(3),
  modelsAllowed: text("models_allowed").array().notNull().default(sql`ARRAY[]::text[]`),
  priceUsd: numeric("price_usd", { precision: 18, scale: 8, mode: "number" }).notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("plans_is_active_idx").on(table.isActive),
  index("plans_name_idx").on(table.name),
]);

export const insertPlanSchema = createInsertSchema(plansTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPlan = z.infer<typeof insertPlanSchema>;
export type Plan = typeof plansTable.$inferSelect;
