import { join } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/**
 * マイグレーション適用スクリプト（`make migrate`）。
 * DATABASE_URL の DB に `backend/drizzle/` の SQL を適用する。
 */
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

const migrationsFolder = join(import.meta.dir, "../../../drizzle");
const sql = postgres(url, { max: 1 });

try {
  await migrate(drizzle(sql), { migrationsFolder });
  console.log("[migrate] done");
} finally {
  await sql.end();
}
