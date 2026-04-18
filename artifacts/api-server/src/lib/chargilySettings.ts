/**
 * Helpers for reading Chargily-related rows from `system_settings`.
 *
 * Defaults are seeded by migration 0009 but admins can update them via
 * /admin/settings. We re-read on every call (no caching) — the volume is
 * tiny (a single key lookup) and admins expect immediate effect.
 */
import { eq } from "drizzle-orm";
import { db, systemSettingsTable } from "@workspace/db";

const DEFAULTS = {
  dzd_to_usd_rate: 135,
  min_topup_dzd: 500,
  max_topup_dzd: 500_000,
} as const;

export const CHARGILY_ENABLED_SETTING = "chargily_enabled";

async function readNumeric(key: string, fallback: number): Promise<number> {
  const [row] = await db
    .select({ value: systemSettingsTable.value })
    .from(systemSettingsTable)
    .where(eq(systemSettingsTable.key, key))
    .limit(1);
  if (!row?.value) return fallback;
  const n = Number(row.value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function readEnabled(): Promise<boolean> {
  const [row] = await db
    .select({ value: systemSettingsTable.value })
    .from(systemSettingsTable)
    .where(eq(systemSettingsTable.key, CHARGILY_ENABLED_SETTING))
    .limit(1);
  // Default to enabled if the setting was never written.
  if (!row?.value) return true;
  return row.value === "true" || row.value === "1";
}

export async function isChargilyEnabled(): Promise<boolean> {
  return readEnabled();
}

export async function getChargilySettings(): Promise<{
  dzdToUsdRate: number;
  minTopupDzd: number;
  maxTopupDzd: number;
  mode: "test" | "live";
  enabled: boolean;
}> {
  const [rate, min, max, enabled] = await Promise.all([
    readNumeric("chargily_dzd_to_usd_rate", DEFAULTS.dzd_to_usd_rate),
    readNumeric("chargily_min_topup_dzd", DEFAULTS.min_topup_dzd),
    readNumeric("chargily_max_topup_dzd", DEFAULTS.max_topup_dzd),
    readEnabled(),
  ]);
  const mode = (process.env.CHARGILY_MODE ?? "test").toLowerCase() === "live" ? "live" : "test";
  return { dzdToUsdRate: rate, minTopupDzd: min, maxTopupDzd: max, mode, enabled };
}

export function dzdToUsd(amountDzd: number, rate: number): number {
  // Round to 8 decimals to match the numeric(18,8) column.
  return Math.round((amountDzd / rate) * 1e8) / 1e8;
}
