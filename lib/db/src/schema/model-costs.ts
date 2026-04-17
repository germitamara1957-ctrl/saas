import { pgTable, text, doublePrecision, boolean, timestamp } from "drizzle-orm/pg-core";

export const modelCostsTable = pgTable("model_costs", {
  model: text("model").primaryKey(),
  inputPer1M: doublePrecision("input_per_1m").notNull().default(0),
  outputPer1M: doublePrecision("output_per_1m").notNull().default(0),
  perImage: doublePrecision("per_image"),
  perSecond: doublePrecision("per_second"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type ModelCost = typeof modelCostsTable.$inferSelect;
export type InsertModelCost = typeof modelCostsTable.$inferInsert;
