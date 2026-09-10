import { desc, eq } from "drizzle-orm";
import type { Db } from "../client.ts";
import { schoolMessages } from "../schema.ts";

export type SchoolMessageRow = typeof schoolMessages.$inferSelect;
export type MessageCategory = "emergency" | "announcement";

export async function createMessage(
  db: Db,
  input: { schoolId: string; teacherId: string; category: MessageCategory; text: string; total: number; sent: number; failed: number },
): Promise<SchoolMessageRow> {
  const rows = await db.insert(schoolMessages).values(input).returning();
  const row = rows[0];
  if (!row) throw new Error("failed to create school message");
  return row;
}

/** 自校の送信履歴（新しい順）。到達状況の可視化用。 */
export async function listBySchool(db: Db, schoolId: string, limit = 100): Promise<SchoolMessageRow[]> {
  return db
    .select()
    .from(schoolMessages)
    .where(eq(schoolMessages.schoolId, schoolId))
    .orderBy(desc(schoolMessages.createdAt))
    .limit(limit);
}
