import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../client.ts";
import { absenceReports, studentProfiles } from "../schema.ts";

export type AbsenceReportRow = typeof absenceReports.$inferSelect;
export type AbsenceType = "欠席" | "遅刻" | "早退" | "休校";
export type AbsenceStatus = "unread" | "confirmed";

export async function createReport(
  db: Db,
  input: {
    schoolId: string;
    studentProfileId: string;
    reportedByUserId: string;
    date: string;
    type: AbsenceType;
    reason?: string | null;
    note?: string | null;
    warningActive: boolean;
  },
): Promise<AbsenceReportRow> {
  const rows = await db
    .insert(absenceReports)
    .values({
      schoolId: input.schoolId,
      studentProfileId: input.studentProfileId,
      reportedByUserId: input.reportedByUserId,
      date: input.date,
      type: input.type,
      reason: input.reason ?? null,
      note: input.note ?? null,
      warningActive: input.warningActive,
    })
    .returning();
  const row = rows[0];
  if (!row) throw new Error("failed to create absence report");
  return row;
}

/** 自分が出した欠席（確認用）。 */
export async function listByReporter(db: Db, reportedByUserId: string): Promise<AbsenceReportRow[]> {
  return db
    .select()
    .from(absenceReports)
    .where(eq(absenceReports.reportedByUserId, reportedByUserId))
    .orderBy(desc(absenceReports.date), desc(absenceReports.createdAt));
}

export interface AbsenceWithStudent {
  id: string;
  date: string;
  type: string;
  reason: string | null;
  note: string | null;
  warningActive: boolean;
  status: string;
  createdAt: Date;
  studentName: string;
  grade: string | null;
  className: string | null;
}

/**
 * 先生ダッシュボード: 自校の欠席一覧（生徒プロフィール結合）。**必ず schoolId でスコープ**。
 * opts.status で絞り込み、opts.flaggedOnly で「警報なし休校」（監視対象）のみ。
 */
export async function listBySchool(
  db: Db,
  schoolId: string,
  opts: { status?: AbsenceStatus } = {},
): Promise<AbsenceWithStudent[]> {
  const conds = [eq(absenceReports.schoolId, schoolId)];
  if (opts.status) conds.push(eq(absenceReports.status, opts.status));
  return db
    .select({
      id: absenceReports.id,
      date: absenceReports.date,
      type: absenceReports.type,
      reason: absenceReports.reason,
      note: absenceReports.note,
      warningActive: absenceReports.warningActive,
      status: absenceReports.status,
      createdAt: absenceReports.createdAt,
      studentName: studentProfiles.studentName,
      grade: studentProfiles.grade,
      className: studentProfiles.className,
    })
    .from(absenceReports)
    .innerJoin(studentProfiles, eq(studentProfiles.id, absenceReports.studentProfileId))
    .where(and(...conds))
    .orderBy(desc(absenceReports.date), desc(absenceReports.createdAt));
}

/** ステータス更新（**schoolId スコープ**。他校の欠席は更新できない）。 */
export async function setStatusInSchool(
  db: Db,
  schoolId: string,
  id: string,
  status: AbsenceStatus,
): Promise<AbsenceReportRow | undefined> {
  const rows = await db
    .update(absenceReports)
    .set({ status })
    .where(and(eq(absenceReports.id, id), eq(absenceReports.schoolId, schoolId)))
    .returning();
  return rows[0];
}
