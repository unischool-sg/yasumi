import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../client.ts";
import { teachers } from "../schema.ts";

export type TeacherRow = typeof teachers.$inferSelect;
export type TeacherRole = "owner" | "teacher";
export type NewTeacher = {
  schoolId: string;
  email: string;
  passwordHash: string;
  name: string;
  role?: TeacherRole;
};

export async function createTeacher(db: Db, input: NewTeacher): Promise<TeacherRow> {
  const rows = await db
    .insert(teachers)
    .values({ ...input, role: input.role ?? "teacher" })
    .returning();
  const row = rows[0];
  if (!row) throw new Error("failed to create teacher");
  return row;
}

export async function findTeacherByEmail(db: Db, email: string): Promise<TeacherRow | undefined> {
  const rows = await db.select().from(teachers).where(eq(teachers.email, email)).limit(1);
  return rows[0];
}

export async function findTeacherById(db: Db, id: string): Promise<TeacherRow | undefined> {
  const rows = await db.select().from(teachers).where(eq(teachers.id, id)).limit(1);
  return rows[0];
}

/** 自校の教員一覧（新しい順・passwordHash は返さない）。 */
export async function listTeachersBySchool(
  db: Db,
  schoolId: string,
): Promise<Omit<TeacherRow, "passwordHash">[]> {
  return db
    .select({
      id: teachers.id,
      schoolId: teachers.schoolId,
      email: teachers.email,
      role: teachers.role,
      name: teachers.name,
      disabled: teachers.disabled,
      createdAt: teachers.createdAt,
    })
    .from(teachers)
    .where(eq(teachers.schoolId, schoolId))
    .orderBy(desc(teachers.createdAt));
}

export async function updateTeacher(
  db: Db,
  id: string,
  patch: { role?: TeacherRole; disabled?: boolean; passwordHash?: string; name?: string },
): Promise<TeacherRow | undefined> {
  if (Object.keys(patch).length === 0) return findTeacherById(db, id);
  const rows = await db.update(teachers).set(patch).where(eq(teachers.id, id)).returning();
  return rows[0];
}

/** テナント境界を守るための削除（school を跨がない）。 */
export async function deleteTeacherInSchool(db: Db, schoolId: string, id: string): Promise<void> {
  await db.delete(teachers).where(and(eq(teachers.id, id), eq(teachers.schoolId, schoolId)));
}

export async function findTeacherInSchool(
  db: Db,
  schoolId: string,
  id: string,
): Promise<TeacherRow | undefined> {
  const rows = await db
    .select()
    .from(teachers)
    .where(and(eq(teachers.id, id), eq(teachers.schoolId, schoolId)))
    .limit(1);
  return rows[0];
}
