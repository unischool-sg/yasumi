import { and, eq } from "drizzle-orm";
import type { Db } from "../client.ts";
import { notifications } from "../schema.ts";

export type NotificationRow = typeof notifications.$inferSelect;

export interface NotificationInput {
  userId: string;
  schoolId: string;
  ruleId: string;
  targetDate: string; // "YYYY-MM-DD"
  status: string; // 判定結果 (CheckResult) など
  sentAt?: Date | null;
}

/**
 * 通知レコードを作成。UNIQUE(user,school,rule,target_date) により二重通知を防止（PRD §36）。
 * @returns created=true なら新規（＝この呼び出しで通知すべき）。false なら既に通知済み。
 */
export async function createNotificationIfAbsent(
  db: Db,
  input: NotificationInput,
): Promise<{ created: boolean; row?: NotificationRow }> {
  const inserted = await db
    .insert(notifications)
    .values({
      userId: input.userId,
      schoolId: input.schoolId,
      ruleId: input.ruleId,
      targetDate: input.targetDate,
      status: input.status,
      sentAt: input.sentAt ?? null,
    })
    .onConflictDoNothing({
      target: [notifications.userId, notifications.schoolId, notifications.ruleId, notifications.targetDate],
    })
    .returning();

  const row = inserted[0];
  return row ? { created: true, row } : { created: false };
}

/** 送信完了時刻を記録。 */
export async function markNotificationSent(db: Db, id: string, sentAt: Date): Promise<void> {
  await db.update(notifications).set({ sentAt }).where(eq(notifications.id, id));
}

export async function findNotification(
  db: Db,
  input: Pick<NotificationInput, "userId" | "schoolId" | "ruleId" | "targetDate">,
): Promise<NotificationRow | undefined> {
  const rows = await db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, input.userId),
        eq(notifications.schoolId, input.schoolId),
        eq(notifications.ruleId, input.ruleId),
        eq(notifications.targetDate, input.targetDate),
      ),
    )
    .limit(1);
  return rows[0];
}
