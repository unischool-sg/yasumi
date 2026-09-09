import { eq, sql } from "drizzle-orm";
import type { Db } from "../client.ts";
import { areas } from "../schema.ts";

export type AreaRow = typeof areas.$inferSelect;

export async function listAreas(db: Db): Promise<AreaRow[]> {
  return db.select().from(areas);
}

export async function listAreasByPrefecture(db: Db, prefecture: string): Promise<AreaRow[]> {
  return db.select().from(areas).where(eq(areas.prefecture, prefecture));
}

export async function upsertArea(db: Db, row: AreaRow): Promise<AreaRow> {
  const rows = await db
    .insert(areas)
    .values(row)
    .onConflictDoUpdate({ target: areas.code, set: { name: row.name, prefecture: row.prefecture } })
    .returning();
  const r = rows[0];
  if (!r) throw new Error("failed to upsert area");
  return r;
}

export async function deleteArea(db: Db, code: string): Promise<void> {
  await db.delete(areas).where(eq(areas.code, code));
}

/** 地域マスタの一括投入（シード用）。既存コードは name/prefecture を更新する。 */
export async function upsertAreas(db: Db, rows: AreaRow[]): Promise<void> {
  if (rows.length === 0) return;
  await db
    .insert(areas)
    .values(rows)
    .onConflictDoUpdate({
      target: areas.code,
      set: { name: sql`excluded.name`, prefecture: sql`excluded.prefecture` },
    });
}
