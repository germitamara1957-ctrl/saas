import { pgTable, serial, text, boolean, timestamp, index } from "drizzle-orm/pg-core";

export const providersTable = pgTable("providers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  projectId: text("project_id").notNull(),
  location: text("location").notNull().default("us-central1"),
  credentialsEncrypted: text("credentials_encrypted").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("providers_is_active_idx").on(table.isActive),
]);

export type Provider = typeof providersTable.$inferSelect;
export type InsertProvider = typeof providersTable.$inferInsert;
