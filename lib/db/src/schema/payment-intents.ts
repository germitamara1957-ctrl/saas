import { pgTable, serial, text, integer, numeric, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { organizationsTable } from "./organizations";

/**
 * Chargily Pay V2 top-up intents.
 *
 * Lifecycle: pending → (paid | failed | canceled | expired). Once a webhook
 * with status=paid arrives, we credit `topupCreditBalance` exactly once via
 * a CAS UPDATE on (id, status='pending') so concurrent webhook deliveries
 * cannot double-credit.
 */
export const paymentIntentsTable = pgTable("payment_intents", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  // Reserved for future per-org top-ups. Currently null (personal credit only).
  organizationId: integer("organization_id").references(() => organizationsTable.id, { onDelete: "set null" }),
  // Chargily checkout id (e.g. "01jh..."). Unique so the webhook handler can
  // dedupe deliveries by the same checkout.
  chargilyCheckoutId: text("chargily_checkout_id").notNull(),
  chargilyCustomerId: text("chargily_customer_id"),
  // Money: amountDzd is the user-facing input; amountUsd is what we credit
  // (amountDzd / exchangeRate, rounded to 8 decimals). Both stored for audit.
  amountDzd: numeric("amount_dzd", { precision: 18, scale: 2, mode: "number" }).notNull(),
  amountUsd: numeric("amount_usd", { precision: 18, scale: 8, mode: "number" }).notNull(),
  exchangeRate: numeric("exchange_rate", { precision: 18, scale: 8, mode: "number" }).notNull(),
  currency: text("currency").notNull().default("dzd"),
  // pending | paid | failed | canceled | expired
  status: text("status").notNull().default("pending"),
  mode: text("mode").notNull().default("test"), // test | live
  checkoutUrl: text("checkout_url"),
  // Timestamps for the full lifecycle.
  webhookReceivedAt: timestamp("webhook_received_at", { withTimezone: true }),
  creditedAt: timestamp("credited_at", { withTimezone: true }),
  failureReason: text("failure_reason"),
  metadata: text("metadata"), // JSON string
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("payment_intents_chargily_checkout_id_uidx").on(table.chargilyCheckoutId),
  index("payment_intents_user_id_idx").on(table.userId),
  index("payment_intents_status_idx").on(table.status),
  index("payment_intents_created_at_idx").on(table.createdAt),
]);

export type PaymentIntent = typeof paymentIntentsTable.$inferSelect;
export type InsertPaymentIntent = typeof paymentIntentsTable.$inferInsert;
