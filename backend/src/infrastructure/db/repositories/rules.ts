import type { CheckResult, RuleCondition, SchoolRule } from "@yasumi/shared";
import { eq } from "drizzle-orm";
import type { Db } from "../client.ts";
import { schoolRules } from "../schema.ts";

export type RuleRow = typeof schoolRules.$inferSelect;

/** DB 行を Rule Engine（M2）の SchoolRule へマップ。condition は null なら WARNING_ACTIVE 扱い。 */
export function toSchoolRule(row: RuleRow): SchoolRule {
  return {
    id: row.id,
    schoolId: row.schoolId,
    checkTime: toHhmm(row.checkTime),
    condition: (row.condition as RuleCondition | null) ?? { type: "WARNING_ACTIVE" },
    result: row.result as CheckResult,
  };
}

export async function listRulesBySchool(db: Db, schoolId: string): Promise<RuleRow[]> {
  return db.select().from(schoolRules).where(eq(schoolRules.schoolId, schoolId));
}

export async function findRuleById(db: Db, id: string): Promise<RuleRow | undefined> {
  const rows = await db.select().from(schoolRules).where(eq(schoolRules.id, id)).limit(1);
  return rows[0];
}

export async function createRule(
  db: Db,
  input: {
    schoolId: string;
    checkTime: string;
    result: CheckResult;
    condition?: RuleCondition;
    message?: string | null;
  },
): Promise<RuleRow> {
  const rows = await db
    .insert(schoolRules)
    .values({
      schoolId: input.schoolId,
      checkTime: toDbTime(input.checkTime),
      result: input.result,
      condition: input.condition ?? { type: "WARNING_ACTIVE" },
      message: input.message ?? null,
    })
    .returning();
  const row = rows[0];
  if (!row) throw new Error("failed to create rule");
  return row;
}

export async function updateRule(
  db: Db,
  id: string,
  patch: { checkTime?: string; result?: CheckResult; condition?: RuleCondition; message?: string | null },
): Promise<RuleRow | undefined> {
  const set: Partial<RuleRow> = {};
  if (patch.checkTime !== undefined) set.checkTime = toDbTime(patch.checkTime);
  if (patch.result !== undefined) set.result = patch.result;
  if (patch.condition !== undefined) set.condition = patch.condition;
  if (patch.message !== undefined) set.message = patch.message;
  const rows = await db.update(schoolRules).set(set).where(eq(schoolRules.id, id)).returning();
  return rows[0];
}

export async function deleteRule(db: Db, id: string): Promise<void> {
  await db.delete(schoolRules).where(eq(schoolRules.id, id));
}

/** 指定時刻(HH:MM)に判定すべきルールを全学校横断で取得（M7 cron）。 */
export async function listRulesByCheckTime(db: Db, hhmm: string): Promise<RuleRow[]> {
  return db.select().from(schoolRules).where(eq(schoolRules.checkTime, toDbTime(hhmm)));
}

/** "HH:MM" or "HH:MM:SS" → DB TIME 用 "HH:MM:00"。 */
function toDbTime(hhmm: string): string {
  const [h = "00", m = "00"] = hhmm.split(":");
  return `${h.padStart(2, "0")}:${m.padStart(2, "0")}:00`;
}

/** DB TIME "HH:MM:SS" → "HH:MM"。 */
function toHhmm(time: string): string {
  const [h = "00", m = "00"] = time.split(":");
  return `${h.padStart(2, "0")}:${m.padStart(2, "0")}`;
}
