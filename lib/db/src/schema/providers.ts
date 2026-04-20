import { pgTable, serial, text, boolean, timestamp, integer, index } from "drizzle-orm/pg-core";

export const providersTable = pgTable("providers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  projectId: text("project_id").notNull(),
  location: text("location").notNull().default("us-central1"),
  credentialsEncrypted: text("credentials_encrypted").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  // Lower number = higher priority. Default 100 so legacy providers stay in
  // current "first created wins" order until an admin sets explicit priorities.
  priority: integer("priority").notNull().default(100),
  // Circuit breaker: when set in the future, this provider is skipped until
  // the timestamp passes. Cleared on next successful call.
  circuitOpenUntil: timestamp("circuit_open_until", { withTimezone: true }),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  lastError: text("last_error"),
  lastFailureAt: timestamp("last_failure_at", { withTimezone: true }),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("providers_is_active_idx").on(table.isActive),
  index("providers_priority_idx").on(table.priority),
]);

export type Provider = typeof providersTable.$inferSelect;
export type InsertProvider = typeof providersTable.$inferInsert;
