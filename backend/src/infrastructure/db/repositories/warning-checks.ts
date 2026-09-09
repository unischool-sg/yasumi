import type { CheckResult, Warning } from "@yasumi/shared";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../client.ts";
import { warningChecks } from "../schema.ts";

export type WarningCheckRow = typeof warningChecks.$inferSelect;

export interface WarningCheckInput {
  schoolId: string;
  ruleId: string;
  targetDate: string; // "YYYY-MM-DD"
  checkedAt: Date;
  warningActive: boolean;
  result: CheckResult;
  rawData?: Warning[] | null;
}

/**
 * 判定結果を保存する。UNIQUE(school_id,rule_id,target_date) により二重判定を防止（PRD §34, §35）。
 * 既に存在する場合は「最初の判定」を保持し、上書きしない（確定性）。
 * @returns { row, created } created=false は既存（冪等スキップ）
 */
export async function upsertWarningCheck(
  db: Db,
  input: WarningCheckInput,
): Promise<{ row: WarningCheckRow; created: boolean }> {
  const inserted = await db
    .insert(warningChecks)
    .values({
      schoolId: input.schoolId,
      ruleId: input.ruleId,
      targetDate: input.targetDate,
      checkedAt: input.checkedAt,
      warningActive: input.warningActive,
      result: input.result,
      rawData: input.rawData ?? null,
    })
    .onConflictDoNothing({
      target: [warningChecks.schoolId, warningChecks.ruleId, warningChecks.targetDate],
    })
    .returning();

  if (inserted[0]) return { row: inserted[0], created: true };

  const existing = await findWarningCheck(db, input.schoolId, input.ruleId, input.targetDate);
  if (!existing) throw new Error("warning_check upsert failed");
  return { row: existing, created: false };
}

export async function findWarningCheck(
  db: Db,
  schoolId: string,
  ruleId: string,
  targetDate: string,
): Promise<WarningCheckRow | undefined> {
  const rows = await db
    .select()
    .from(warningChecks)
    .where(
      and(
        eq(warningChecks.schoolId, schoolId),
        eq(warningChecks.ruleId, ruleId),
        eq(warningChecks.targetDate, targetDate),
      ),
    )
    .limit(1);
  return rows[0];
}

/** 学校の指定日の判定（ホーム: 今日の状態）。checkedAt 降順。 */
export async function listWarningChecksBySchoolAndDate(
  db: Db,
  schoolId: string,
  targetDate: string,
): Promise<WarningCheckRow[]> {
  return db
    .select()
    .from(warningChecks)
    .where(and(eq(warningChecks.schoolId, schoolId), eq(warningChecks.targetDate, targetDate)))
    .orderBy(desc(warningChecks.checkedAt));
}

/** 学校の判定履歴（新しい順）。 */
export async function listWarningChecksBySchool(
  db: Db,
  schoolId: string,
  limit = 50,
): Promise<WarningCheckRow[]> {
  return db
    .select()
    .from(warningChecks)
    .where(eq(warningChecks.schoolId, schoolId))
    .orderBy(desc(warningChecks.checkedAt))
    .limit(limit);
}

/** 管理画面: 判定履歴一覧（任意で school/date フィルタ）。 */
export async function listWarningChecks(
  db: Db,
  filter: { schoolId?: string; targetDate?: string } = {},
  limit = 100,
): Promise<WarningCheckRow[]> {
  const conds = [];
  if (filter.schoolId) conds.push(eq(warningChecks.schoolId, filter.schoolId));
  if (filter.targetDate) conds.push(eq(warningChecks.targetDate, filter.targetDate));
  const base = db.select().from(warningChecks);
  const q = conds.length > 0 ? base.where(and(...conds)) : base;
  return q.orderBy(desc(warningChecks.checkedAt)).limit(limit);
}

export async function countWarningChecksByDate(db: Db, targetDate: string): Promise<number> {
  const rows = await db
    .select({ id: warningChecks.id })
    .from(warningChecks)
    .where(eq(warningChecks.targetDate, targetDate));
  return rows.length;
}
