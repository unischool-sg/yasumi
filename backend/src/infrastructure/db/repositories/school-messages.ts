import { and, count, desc, eq, gte } from "drizzle-orm";
import type { Db } from "../client.ts";
import { messageConfirmations, schoolMessages } from "../schema.ts";

export type SchoolMessageRow = typeof schoolMessages.$inferSelect;
export type MessageCategory = "emergency" | "announcement";

export async function createMessage(
  db: Db,
  input: {
    schoolId: string;
    teacherId: string;
    category: MessageCategory;
    kind?: string;
    text: string;
    total: number;
    sent: number;
    failed: number;
    requireConfirmation?: boolean;
  },
): Promise<SchoolMessageRow> {
  const rows = await db
    .insert(schoolMessages)
    .values({ ...input, kind: input.kind ?? "general", requireConfirmation: input.requireConfirmation ?? false })
    .returning();
  const row = rows[0];
  if (!row) throw new Error("failed to create school message");
  return row;
}

/** 指定時刻以降の「お知らせ」送信数（月間通数カウンタ用）。emergency は数えない。 */
export async function countAnnouncementsSince(db: Db, schoolId: string, since: Date): Promise<number> {
  const rows = await db
    .select({ id: schoolMessages.id })
    .from(schoolMessages)
    .where(
      and(
        eq(schoolMessages.schoolId, schoolId),
        eq(schoolMessages.category, "announcement"),
        gte(schoolMessages.createdAt, since),
      ),
    );
  return rows.length;
}

/** 送信後に到達数を更新（確認リンク付き送信は id 確定→送信→集計の順のため）。 */
export async function updateCounts(db: Db, id: string, sent: number, failed: number): Promise<void> {
  await db.update(schoolMessages).set({ sent, failed }).where(eq(schoolMessages.id, id));
}

export type SchoolMessageWithConfirm = SchoolMessageRow & { confirmedCount: number };

/** 自校の送信履歴（新しい順・確認数付き）。到達状況＋確認率の可視化用。 */
export async function listBySchool(db: Db, schoolId: string, limit = 100): Promise<SchoolMessageWithConfirm[]> {
  return db
    .select({
      id: schoolMessages.id,
      schoolId: schoolMessages.schoolId,
      teacherId: schoolMessages.teacherId,
      category: schoolMessages.category,
      kind: schoolMessages.kind,
      text: schoolMessages.text,
      total: schoolMessages.total,
      sent: schoolMessages.sent,
      failed: schoolMessages.failed,
      requireConfirmation: schoolMessages.requireConfirmation,
      createdAt: schoolMessages.createdAt,
      confirmedCount: count(messageConfirmations.userId),
    })
    .from(schoolMessages)
    .leftJoin(messageConfirmations, eq(messageConfirmations.messageId, schoolMessages.id))
    .where(eq(schoolMessages.schoolId, schoolId))
    .groupBy(schoolMessages.id)
    .orderBy(desc(schoolMessages.createdAt))
    .limit(limit);
}
