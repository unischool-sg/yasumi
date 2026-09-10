import { count, desc, eq, ilike, sql } from "drizzle-orm";
import type { Db } from "../client.ts";
import { schools, subscriptions } from "../schema.ts";

export type SchoolRow = typeof schools.$inferSelect;
export type NewSchool = {
  name: string;
  prefecture: string;
  city?: string | null;
  websiteUrl?: string | null;
  rulesUrl?: string | null;
  studentCount?: number | null;
  plan?: string | null;
  planExpiresAt?: Date | null;
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

/** 公開: 登録済み学校の一覧（landing の学校一覧ページ用）。PII は返さず公開安全な列のみ。 */
export type PublicSchool = {
  id: string;
  name: string;
  prefecture: string;
  city: string | null;
  websiteUrl: string | null;
};

export async function listPublicSchools(db: Db): Promise<PublicSchool[]> {
  return db
    .select({
      id: schools.id,
      name: schools.name,
      prefecture: schools.prefecture,
      city: schools.city,
      websiteUrl: schools.websiteUrl,
    })
    .from(schools)
    .orderBy(schools.prefecture, schools.name);
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

/**
 * 管理画面(営業指標): 学校ごとの購読者数・通知ON数・浸透率の分母(生徒数)を集計。
 * 購読者数の多い順 = セールスで狙える「校内密度が高い」学校の順。浸透率は分母がある学校のみ算出可。
 */
export type SchoolStatsRow = {
  id: string;
  name: string;
  prefecture: string;
  city: string | null;
  studentCount: number | null;
  subscriberCount: number;
  enabledCount: number;
  createdAt: Date;
};

export async function listSchoolsWithStats(db: Db): Promise<SchoolStatsRow[]> {
  return db
    .select({
      id: schools.id,
      name: schools.name,
      prefecture: schools.prefecture,
      city: schools.city,
      studentCount: schools.studentCount,
      subscriberCount: count(subscriptions.userId),
      enabledCount: sql<number>`count(*) filter (where ${subscriptions.notificationEnabled})`.mapWith(Number),
      createdAt: schools.createdAt,
    })
    .from(schools)
    .leftJoin(subscriptions, eq(subscriptions.schoolId, schools.id))
    .groupBy(schools.id)
    .orderBy(desc(count(subscriptions.userId)), desc(schools.createdAt));
}

export async function countSchools(db: Db): Promise<number> {
  const rows = await db.select({ id: schools.id }).from(schools);
  return rows.length;
}

export async function deleteSchool(db: Db, id: string): Promise<void> {
  await db.delete(schools).where(eq(schools.id, id));
}
