/**
 * Standalone migration runner.
 *
 * Runs all pending Drizzle migrations and then exits.
 * Intended to be executed BEFORE starting the API server, e.g.:
 *
 *   node dist/migrate.mjs && node dist/index.mjs
 *
 * The migrations folder is resolved in this order:
 *   1. MIGRATIONS_DIR env var (useful in Docker where migrations are copied to /app/migrations)
 *   2. Relative path from this file up to lib/db/migrations (development / PM2)
 */
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "@workspace/db";
import path from "node:path";

const migrationsFolder =
  process.env["MIGRATIONS_DIR"] ??
  path.resolve(__dirname, "../../../lib/db/migrations");

async function runMigrations(): Promise<void> {
  console.log(`[migrate] Running migrations from: ${migrationsFolder}`);
  await migrate(db, { migrationsFolder });
  console.log("[migrate] All migrations applied successfully.");
  await pool.end();
}

runMigrations().catch((err: unknown) => {
  console.error("[migrate] Migration failed:", err);
  process.exit(1);
});
