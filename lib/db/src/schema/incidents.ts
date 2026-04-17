import { pgTable, serial, text, timestamp, index } from "drizzle-orm/pg-core";

export const incidentsTable = pgTable("incidents", {
  id: serial("id").primaryKey(),
  titleEn: text("title_en").notNull(),
  titleAr: text("title_ar").notNull(),
  bodyEn: text("body_en").notNull().default(""),
  bodyAr: text("body_ar").notNull().default(""),
  status: text("status").notNull().default("investigating"),
  severity: text("severity").notNull().default("minor"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("incidents_started_at_idx").on(t.startedAt),
  index("incidents_resolved_at_idx").on(t.resolvedAt),
]);

export type Incident = typeof incidentsTable.$inferSelect;
