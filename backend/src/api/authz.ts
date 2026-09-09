import type { Db } from "../infrastructure/db/client.ts";
import { findSchoolById } from "../infrastructure/db/repositories/schools.ts";

/** 管理者判定（MVP: 環境変数で許可した LINE ユーザーID / PRD §23）。 */
export function isAdmin(lineUserId: string, adminLineUserIds: string[]): boolean {
  return adminLineUserIds.includes(lineUserId);
}

/**
 * 学校を編集できるか（作成者 or 管理者のみ / PRD §23）。
 * @returns "ok" | "not_found" | "forbidden"
 */
export async function checkSchoolEditable(
  db: Db,
  params: { schoolId: string; userId: string; lineUserId: string; adminLineUserIds: string[] },
): Promise<"ok" | "not_found" | "forbidden"> {
  const school = await findSchoolById(db, params.schoolId);
  if (!school) return "not_found";
  if (school.createdBy === params.userId) return "ok";
  if (isAdmin(params.lineUserId, params.adminLineUserIds)) return "ok";
  return "forbidden";
}
