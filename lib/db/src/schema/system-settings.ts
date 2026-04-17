import { pgTable, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const systemSettingsTable = pgTable("system_settings", {
  key: text("key").primaryKey(),
  value: text("value"),
  encrypted: boolean("encrypted").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type SystemSetting = typeof systemSettingsTable.$inferSelect;
export type InsertSystemSetting = typeof systemSettingsTable.$inferInsert;
