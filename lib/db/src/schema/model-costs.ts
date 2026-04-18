import { pgTable, text, numeric, boolean, timestamp } from "drizzle-orm/pg-core";

export const modelCostsTable = pgTable("model_costs", {
  model: text("model").primaryKey(),
  inputPer1M: numeric("input_per_1m", { precision: 18, scale: 8, mode: "number" }).notNull().default(0),
  outputPer1M: numeric("output_per_1m", { precision: 18, scale: 8, mode: "number" }).notNull().default(0),
  perImage: numeric("per_image", { precision: 18, scale: 8, mode: "number" }),
  perSecond: numeric("per_second", { precision: 18, scale: 8, mode: "number" }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type ModelCost = typeof modelCostsTable.$inferSelect;
export type InsertModelCost = typeof modelCostsTable.$inferInsert;
