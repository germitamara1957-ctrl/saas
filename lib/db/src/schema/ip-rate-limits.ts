import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";

export const ipRateLimitsTable = pgTable("ip_rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(1),
  resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
});

export type IpRateLimit = typeof ipRateLimitsTable.$inferSelect;
