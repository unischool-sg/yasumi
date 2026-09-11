import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../client.ts";
import { closureDrafts } from "../schema.ts";

export type ClosureDraftRow = typeof closureDrafts.$inferSelect;
export type ClosureDraftStatus = "pending" | "sent" | "dismissed";

/**
 * 同日1件だけの pending ドラフトを作る（既にあれば作らない）。
 * UNIQUE(school_id,target_date) により重複生成を防止。
 */
export async function upsertPendingDraft(
  db: Db,
  input: { schoolId: string; targetDate: string; result: string; text: string },
): Promise<void> {
  await db
    .insert(closureDrafts)
    .values({ ...input, status: "pending" })
    .onConflictDoNothing({ target: [closureDrafts.schoolId, closureDrafts.targetDate] });
}

export async function listPendingBySchool(db: Db, schoolId: string): Promise<ClosureDraftRow[]> {
  return db
    .select()
    .from(closureDrafts)
    .where(and(eq(closureDrafts.schoolId, schoolId), eq(closureDrafts.status, "pending")))
    .orderBy(desc(closureDrafts.createdAt));
}

/** テナント境界を守って取得（他校のドラフトは取れない）。 */
export async function findInSchool(db: Db, schoolId: string, id: string): Promise<ClosureDraftRow | undefined> {
  const rows = await db
    .select()
    .from(closureDrafts)
    .where(and(eq(closureDrafts.id, id), eq(closureDrafts.schoolId, schoolId)))
    .limit(1);
  return rows[0];
}

export async function setStatusInSchool(
  db: Db,
  schoolId: string,
  id: string,
  status: ClosureDraftStatus,
): Promise<ClosureDraftRow | undefined> {
  const rows = await db
    .update(closureDrafts)
    .set({ status })
    .where(and(eq(closureDrafts.id, id), eq(closureDrafts.schoolId, schoolId)))
    .returning();
  return rows[0];
}
