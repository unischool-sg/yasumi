import type { School } from "@yasumi/shared";
import { and, eq } from "drizzle-orm";
import type { Db } from "../client.ts";
import { schoolAreas, schoolWarningTypes, schools } from "../schema.ts";

/** 学校の対象地域コード一覧。 */
export async function getAreaCodes(db: Db, schoolId: string): Promise<string[]> {
  const rows = await db
    .select({ areaCode: schoolAreas.areaCode })
    .from(schoolAreas)
    .where(eq(schoolAreas.schoolId, schoolId));
  return rows.map((r) => r.areaCode);
}

/** 学校の対象警報種別一覧。 */
export async function getWarningTypes(db: Db, schoolId: string): Promise<string[]> {
  const rows = await db
    .select({ warningType: schoolWarningTypes.warningType })
    .from(schoolWarningTypes)
    .where(eq(schoolWarningTypes.schoolId, schoolId));
  return rows.map((r) => r.warningType);
}

/** 対象地域を丸ごと置き換える（登録/編集 / PRD §13 Step2）。 */
export async function setAreaCodes(db: Db, schoolId: string, areaCodes: string[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(schoolAreas).where(eq(schoolAreas.schoolId, schoolId));
    if (areaCodes.length > 0) {
      await tx.insert(schoolAreas).values(areaCodes.map((areaCode) => ({ schoolId, areaCode })));
    }
  });
}

/** 対象警報を丸ごと置き換える（PRD §13 Step3）。 */
export async function setWarningTypes(db: Db, schoolId: string, warningTypes: string[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(schoolWarningTypes).where(eq(schoolWarningTypes.schoolId, schoolId));
    if (warningTypes.length > 0) {
      await tx.insert(schoolWarningTypes).values(warningTypes.map((warningType) => ({ schoolId, warningType })));
    }
  });
}

/** Rule Engine（M2）の入力となる `School`（@yasumi/shared）を組み立てる。 */
export async function buildEngineSchool(db: Db, schoolId: string): Promise<School | undefined> {
  const rows = await db
    .select({ id: schools.id, name: schools.name })
    .from(schools)
    .where(eq(schools.id, schoolId))
    .limit(1);
  const school = rows[0];
  if (!school) return undefined;
  const [areaCodes, warningTypes] = await Promise.all([
    getAreaCodes(db, schoolId),
    getWarningTypes(db, schoolId),
  ]);
  return { id: school.id, name: school.name, areaCodes, warningTypes };
}

/** 指定学校が特定地域を対象にしているか（デバッグ/検証補助）。 */
export async function hasArea(db: Db, schoolId: string, areaCode: string): Promise<boolean> {
  const rows = await db
    .select({ areaCode: schoolAreas.areaCode })
    .from(schoolAreas)
    .where(and(eq(schoolAreas.schoolId, schoolId), eq(schoolAreas.areaCode, areaCode)))
    .limit(1);
  return rows.length > 0;
}
