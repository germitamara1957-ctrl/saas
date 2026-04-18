import { pgTable, serial, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Chargily webhook event log — one row per delivery for replay protection
 * and forensic audit. The `signature` column is unique so a duplicate
 * delivery from Chargily is rejected at the DB level.
 */
export const chargilyWebhookEventsTable = pgTable("chargily_webhook_events", {
  id: serial("id").primaryKey(),
  // Chargily event id (from payload). Used as the natural unique key.
  eventId: text("event_id").notNull(),
  eventType: text("event_type").notNull(), // checkout.paid | checkout.failed | ...
  // Full HMAC signature header value (used for replay detection if eventId missing).
  signature: text("signature").notNull(),
  payload: text("payload").notNull(), // raw JSON for audit
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("chargily_webhook_events_event_id_uidx").on(table.eventId),
  index("chargily_webhook_events_processed_at_idx").on(table.processedAt),
]);

export type ChargilyWebhookEvent = typeof chargilyWebhookEventsTable.$inferSelect;
