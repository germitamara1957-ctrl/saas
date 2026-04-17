import { pgTable, serial, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { apiKeysTable } from "./api-keys";

export const violationLogsTable = pgTable("violation_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  apiKeyId: integer("api_key_id").references(() => apiKeysTable.id, { onDelete: "set null" }),
  requestId: text("request_id").notNull(),
  model: text("model").notNull(),
  violationCategory: text("violation_category").notNull(),
  violationNumber: integer("violation_number").notNull(),
  messageContent: text("message_content").notNull(),
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("violation_logs_user_id_idx").on(table.userId),
  index("violation_logs_created_at_idx").on(table.createdAt),
  index("violation_logs_category_idx").on(table.violationCategory),
]);

export const insertViolationLogSchema = createInsertSchema(violationLogsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertViolationLog = z.infer<typeof insertViolationLogSchema>;
export type ViolationLog = typeof violationLogsTable.$inferSelect;
