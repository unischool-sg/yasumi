import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.ts";

/**
 * DATABASE_URL から Drizzle クライアントを生成する（backend/DB.md §2）。
 * アプリ全体で単一インスタンスを共有する。
 */
export function createDb(databaseUrl: string) {
  const sql = postgres(databaseUrl);
  return drizzle(sql, { schema });
}

export type Db = ReturnType<typeof createDb>;

let singleton: Db | undefined;

/** 環境変数 DATABASE_URL を用いた共有インスタンス。 */
export function getDb(): Db {
  if (!singleton) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    singleton = createDb(url);
  }
  return singleton;
}
