/**
 * Database migration runner.
 *
 * Reads SQL files from the migrations/ directory in alphabetical order
 * and applies any that haven't been applied yet, tracking them in a
 * `_migrations` table.
 *
 * Usage:
 *   pnpm --filter @workspace/db run migrate
 *
 * In Docker Compose, the `migrate` service runs this before the app starts.
 */

import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, "..", "migrations");

const { Pool } = pg;

async function run() {
  if (!process.env.DATABASE_URL) {
    console.error("[migrate] DATABASE_URL is not set");
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 3,
    connectionTimeoutMillis: 10_000,
  });

  const client = await pool.connect();

  try {
    // Create migration tracking table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id         SERIAL PRIMARY KEY,
        filename   TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `);

    // Read all .sql files from migrations directory
    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort(); // alphabetical order ensures correct sequence

    if (files.length === 0) {
      console.log("[migrate] No migration files found");
      return;
    }

    // Get already-applied migrations
    const { rows: applied } = await client.query<{ filename: string }>(
      "SELECT filename FROM _migrations ORDER BY filename"
    );
    const appliedSet = new Set(applied.map((r) => r.filename));

    const pending = files.filter((f) => !appliedSet.has(f));

    if (pending.length === 0) {
      console.log(`[migrate] All ${files.length} migration(s) already applied`);
      return;
    }

    console.log(`[migrate] Applying ${pending.length} pending migration(s)...`);

    for (const filename of pending) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, filename), "utf8");

      console.log(`[migrate]   → ${filename}`);

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO _migrations (filename) VALUES ($1)",
          [filename]
        );
        await client.query("COMMIT");
        console.log(`[migrate]   ✓ ${filename}`);
      } catch (err) {
        await client.query("ROLLBACK");
        console.error(`[migrate]   ✗ ${filename}: ${(err as Error).message}`);
        throw err;
      }
    }

    console.log(`[migrate] Done — ${pending.length} migration(s) applied`);
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error("[migrate] Fatal error:", err.message);
  process.exit(1);
});
