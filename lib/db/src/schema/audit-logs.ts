import { pgTable, serial, text, timestamp, integer, index } from "drizzle-orm/pg-core";

export const auditLogsTable = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  action: text("action").notNull(),
  actorId: integer("actor_id"),
  actorEmail: text("actor_email"),
  targetId: integer("target_id"),
  targetEmail: text("target_email"),
  details: text("details"),
  ip: text("ip"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("audit_logs_actor_idx").on(table.actorId),
  index("audit_logs_created_at_idx").on(table.createdAt),
]);

export type AuditLog = typeof auditLogsTable.$inferSelect;
