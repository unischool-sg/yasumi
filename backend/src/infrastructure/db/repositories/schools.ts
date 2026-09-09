import { eq, ilike } from "drizzle-orm";
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
