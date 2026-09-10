import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../client.ts";
import { studentProfiles } from "../schema.ts";

export type StudentProfileRow = typeof studentProfiles.$inferSelect;

export async function createProfile(
  db: Db,
  input: { schoolId: string; ownerUserId: string; studentName: string; grade?: string | null; className?: string | null },
): Promise<StudentProfileRow> {
  const rows = await db
    .insert(studentProfiles)
    .values({
      schoolId: input.schoolId,
      ownerUserId: input.ownerUserId,
      studentName: input.studentName,
      grade: input.grade ?? null,
      className: input.className ?? null,
    })
    .returning();
  const row = rows[0];
  if (!row) throw new Error("failed to create student profile");
  return row;
}

/** 自分（owner）の生徒プロフィール一覧。 */
export async function listByOwner(db: Db, ownerUserId: string): Promise<StudentProfileRow[]> {
  return db
    .select()
    .from(studentProfiles)
    .where(eq(studentProfiles.ownerUserId, ownerUserId))
    .orderBy(desc(studentProfiles.createdAt));
}

/** 所有権を確かめて取得（id かつ ownerUserId 一致のみ）。他人のプロフィールは取れない。 */
export async function findByIdForOwner(
  db: Db,
  id: string,
  ownerUserId: string,
): Promise<StudentProfileRow | undefined> {
  const rows = await db
    .select()
    .from(studentProfiles)
    .where(and(eq(studentProfiles.id, id), eq(studentProfiles.ownerUserId, ownerUserId)))
    .limit(1);
  return rows[0];
}
