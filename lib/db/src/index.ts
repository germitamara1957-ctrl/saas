import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const dbUrl = process.env.DATABASE_URL!;
const hasSslInUrl = /sslmode=|ssl=/.test(dbUrl);

export const pool = new Pool({
  connectionString: dbUrl,
  ssl: hasSslInUrl ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 20000,
  connectionTimeoutMillis: 10000,
});

// Prevent unhandled SSL / connection errors from crashing the process.
// pg emits 'error' on the pool when an idle client encounters a network error
// (e.g. Neon drops the connection after its 30 s idle timeout, or Node 24
// raises ERR_SSL_MEMORY_LIMIT_EXCEEDED while tearing down a TLS socket).
pool.on("error", (err: Error) => {
  console.error("[db] pg pool idle client error (non-fatal):", err.message);
});

export const db = drizzle(pool, { schema });

export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export * from "./schema";
