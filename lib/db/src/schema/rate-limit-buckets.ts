import { pgTable, integer, doublePrecision, timestamp, varchar, primaryKey } from "drizzle-orm/pg-core";

/**
 * Generic token bucket — composite PK (`userId`, `endpointGroup`) so each
 * endpoint group (chat / video / embeddings / generate / responses / all)
 * gets its own bucket per user. This prevents one busy endpoint from
 * starving the others.
 *
 * Table name is `rate_limit_buckets_v2` (versioned) because the previous
 * single-PK shape (`rate_limit_buckets`) cannot be migrated in-place by
 * drizzle-kit push without manual SQL — push generates an ALTER ADD
 * CONSTRAINT referencing the new column before adding the column itself.
 * Versioning the table name avoids that ALTER entirely: drizzle just
 * issues a clean CREATE TABLE on first deploy. The old table is harmless
 * (ephemeral cache; no FKs in or out) and may be dropped at any time.
 *
 * `userId` semantics:
 *   - positive value = userId (account-wide bucket)
 *   - negative value = -apiKeyId (per-key override bucket)
 */
export const rateLimitBucketsTable = pgTable("rate_limit_buckets_v2", {
  userId: integer("user_id").notNull(),
  endpointGroup: varchar("endpoint_group", { length: 32 }).notNull().default("all"),
  tokens: doublePrecision("tokens").notNull(),
  lastRefillAt: timestamp("last_refill_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  pk: primaryKey({ columns: [table.userId, table.endpointGroup] }),
}));

export type RateLimitBucket = typeof rateLimitBucketsTable.$inferSelect;
