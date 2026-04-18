import { pgTable, serial, text, integer, timestamp, numeric, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { apiKeysTable } from "./api-keys";

export const usageLogsTable = pgTable("usage_logs", {
  id: serial("id").primaryKey(),
  apiKeyId: integer("api_key_id").references(() => apiKeysTable.id, { onDelete: "set null" }),
  // Optional: when the call billed against an organization pool, this stamps which one.
  // Enables org-level usage analytics + spend-cap enforcement without joining api_keys.
  organizationId: integer("organization_id"),
  model: text("model").notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  totalTokens: integer("total_tokens").notNull().default(0),
  costUsd: numeric("cost_usd", { precision: 18, scale: 8, mode: "number" }).notNull().default(0),
  requestId: text("request_id").notNull(),
  jobOperationId: text("job_operation_id"),
  status: text("status").notNull().default("success"),
  errorMessage: text("error_message"),
  // Logs Viewer: request/response bodies, truncated to 64KB each
  requestBody: text("request_body"),
  responseBody: text("response_body"),
  endpoint: text("endpoint"),
  statusCode: integer("status_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("usage_logs_api_key_id_idx").on(table.apiKeyId),
  index("usage_logs_created_at_idx").on(table.createdAt),
  index("usage_logs_api_key_created_idx").on(table.apiKeyId, table.createdAt),
  index("usage_logs_status_idx").on(table.status),
  index("usage_logs_model_idx").on(table.model),
  index("usage_logs_org_id_idx").on(table.organizationId),
  index("usage_logs_org_created_idx").on(table.organizationId, table.createdAt),
  index("usage_logs_request_id_idx").on(table.requestId),
]);

export const insertUsageLogSchema = createInsertSchema(usageLogsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertUsageLog = z.infer<typeof insertUsageLogSchema>;
export type UsageLog = typeof usageLogsTable.$inferSelect;
