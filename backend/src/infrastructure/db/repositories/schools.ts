import { desc, eq, ilike } from "drizzle-orm";
import type { Db } from "../client.ts";
import { schools } from "../schema.ts";

export type SchoolRow = typeof schools.$inferSelect;
export type NewSchool = {
  name: string;
  prefecture: string;
  city?: string | null;
  websiteUrl?: string | null;
  rulesUrl?: string | null;
  createdBy?: string | null;
};

export async function createSchool(db: Db, input: NewSchool): Promise<SchoolRow> {
  const rows = await db.insert(schools).values(input).returning();
  const row = rows[0];
  if (!row) throw new Error("failed to create school");
  return row;
}

export async function findSchoolById(db: Db, id: string): Promise<SchoolRow | undefined> {
  const rows = await db.select().from(schools).where(eq(schools.id, id)).limit(1);
  return rows[0];
}

/** 学校名の部分一致検索（PRD §11, §37 search）。 */
export async function searchSchools(db: Db, q: string, limit = 20): Promise<SchoolRow[]> {
  return db
    .select()
    .from(schools)
    .where(ilike(schools.name, `%${q}%`))
    .limit(limit);
}

export async function updateSchool(
  db: Db,
  id: string,
  patch: Partial<NewSchool>,
): Promise<SchoolRow | undefined> {
  const rows = await db
    .update(schools)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(schools.id, id))
    .returning();
  return rows[0];
}

/** 自分が作成した学校の一覧（LIFF「編集」タブ / 新しい順）。 */
export async function listSchoolsByCreator(db: Db, userId: string): Promise<SchoolRow[]> {
  return db
    .select()
    .from(schools)
    .where(eq(schools.createdBy, userId))
    .orderBy(desc(schools.createdAt));
}

/** 管理画面: 全学校の一覧（新しい順・ページング）。 */
export async function listSchools(db: Db, opts: { limit?: number; offset?: number } = {}): Promise<SchoolRow[]> {
  return db
    .select()
    .from(schools)
    .orderBy(desc(schools.createdAt))
    .limit(opts.limit ?? 100)
    .offset(opts.offset ?? 0);
}

export async function countSchools(db: Db): Promise<number> {
  const rows = await db.select({ id: schools.id }).from(schools);
  return rows.length;
}

export async function deleteSchool(db: Db, id: string): Promise<void> {
  await db.delete(schools).where(eq(schools.id, id));
}
