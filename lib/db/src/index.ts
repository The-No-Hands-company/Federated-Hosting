import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max:                     parseInt(process.env.DB_POOL_MAX               ?? "20"),
  min:                     parseInt(process.env.DB_POOL_MIN               ?? "2"),
  idleTimeoutMillis:       parseInt(process.env.DB_IDLE_TIMEOUT_MS        ?? "30000"),
  connectionTimeoutMillis: parseInt(process.env.DB_CONNECT_TIMEOUT_MS     ?? "5000"),
  allowExitOnIdle: false,
});

pool.on("error", (err) => {
  console.error("[db] Unexpected pool error:", err.message);
});

export const db = drizzle(pool, { schema });

export * from "./schema";
