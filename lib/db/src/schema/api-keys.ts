import { pgTable, serial, text, integer, boolean, timestamp, numeric, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { plansTable } from "./plans";

export const apiKeysTable = pgTable("api_keys", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  planId: integer("plan_id").references(() => plansTable.id, { onDelete: "set null" }),
  // Optional: if set, this key bills against the organization's credit pool instead of the user's.
  organizationId: integer("organization_id"),
  keyPrefix: text("key_prefix").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  keyEncrypted: text("key_encrypted"),
  name: text("name"),
  creditBalance: numeric("credit_balance", { precision: 18, scale: 8, mode: "number" }).notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  // Per-key overrides (null = inherit from plan / no cap)
  rpmLimit: integer("rpm_limit"),
  monthlySpendLimitUsd: numeric("monthly_spend_limit_usd", { precision: 18, scale: 8, mode: "number" }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  // Optional grace-period expiration set during key rotation. When the user
  // rotates a key, the OLD key is kept active until `expiresAt` so existing
  // deployments can roll over without downtime.
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("api_keys_user_id_idx").on(table.userId),
  index("api_keys_key_hash_idx").on(table.keyHash),
  index("api_keys_is_active_idx").on(table.isActive),
  index("api_keys_plan_id_idx").on(table.planId),
  index("api_keys_organization_id_idx").on(table.organizationId),
]);

export const insertApiKeySchema = createInsertSchema(apiKeysTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertApiKey = z.infer<typeof insertApiKeySchema>;
export type ApiKey = typeof apiKeysTable.$inferSelect;
