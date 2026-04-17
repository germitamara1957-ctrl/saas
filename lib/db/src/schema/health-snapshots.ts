import { pgTable, serial, boolean, integer, timestamp, index } from "drizzle-orm/pg-core";

export const healthSnapshotsTable = pgTable("health_snapshots", {
  id: serial("id").primaryKey(),
  ok: boolean("ok").notNull(),
  latencyMs: integer("latency_ms").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("health_snapshots_created_at_idx").on(t.createdAt),
]);

export type HealthSnapshot = typeof healthSnapshotsTable.$inferSelect;
