import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../client.ts";
import { subscriptions } from "../schema.ts";

export type SubscriptionRow = typeof subscriptions.$inferSelect;

export async function listSubscriptionsByUser(db: Db, userId: string): Promise<SubscriptionRow[]> {
  return db.select().from(subscriptions).where(eq(subscriptions.userId, userId));
}

/** 購読を作成/更新（PRD §37 POST subscriptions）。 */
export async function upsertSubscription(
  db: Db,
  input: { userId: string; schoolId: string; notificationEnabled?: boolean },
): Promise<SubscriptionRow> {
  const rows = await db
    .insert(subscriptions)
    .values({
      userId: input.userId,
      schoolId: input.schoolId,
      notificationEnabled: input.notificationEnabled ?? true,
    })
    .onConflictDoUpdate({
      target: [subscriptions.userId, subscriptions.schoolId],
      set: { notificationEnabled: input.notificationEnabled ?? true },
    })
    .returning();
  const row = rows[0];
  if (!row) throw new Error("failed to upsert subscription");
  return row;
}

export async function removeSubscription(db: Db, userId: string, schoolId: string): Promise<void> {
  await db
    .delete(subscriptions)
    .where(and(eq(subscriptions.userId, userId), eq(subscriptions.schoolId, schoolId)));
}

/** 管理画面: 全購読一覧（新しい順・ページング）。 */
export async function listAllSubscriptions(
  db: Db,
  opts: { limit?: number; offset?: number } = {},
): Promise<SubscriptionRow[]> {
  return db
    .select()
    .from(subscriptions)
    .orderBy(desc(subscriptions.createdAt))
    .limit(opts.limit ?? 100)
    .offset(opts.offset ?? 0);
}

export async function countSubscriptions(db: Db): Promise<number> {
  const rows = await db.select({ schoolId: subscriptions.schoolId }).from(subscriptions);
  return rows.length;
}

/** 通知有効な購読ユーザーを学校単位で取得（M7 通知配信）。 */
export async function listEnabledSubscribersBySchool(db: Db, schoolId: string): Promise<SubscriptionRow[]> {
  return db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.schoolId, schoolId), eq(subscriptions.notificationEnabled, true)));
}
