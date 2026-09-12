import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../client.ts";
import { lineAccounts, schools, studentProfiles, subscriptions } from "../schema.ts";

export type SubscriptionRow = typeof subscriptions.$inferSelect;

export async function listSubscriptionsByUser(db: Db, userId: string): Promise<SubscriptionRow[]> {
  return db.select().from(subscriptions).where(eq(subscriptions.userId, userId));
}

/** 管理画面: ユーザーの購読を学校名付きで取得（新しい順）。 */
export async function listSubscriptionsWithSchoolByUser(
  db: Db,
  userId: string,
): Promise<{ schoolId: string; schoolName: string; notificationEnabled: boolean; createdAt: Date }[]> {
  return db
    .select({
      schoolId: subscriptions.schoolId,
      schoolName: schools.name,
      notificationEnabled: subscriptions.notificationEnabled,
      createdAt: subscriptions.createdAt,
    })
    .from(subscriptions)
    .innerJoin(schools, eq(schools.id, subscriptions.schoolId))
    .where(eq(subscriptions.userId, userId))
    .orderBy(desc(subscriptions.createdAt));
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

/** 管理画面: 学校を購読しているユーザー一覧（新しい順・lineUserId 付き）。 */
export async function listSubscribersBySchool(
  db: Db,
  schoolId: string,
): Promise<{ userId: string; lineUserId: string | null; notificationEnabled: boolean; createdAt: Date }[]> {
  return db
    .select({
      userId: subscriptions.userId,
      lineUserId: lineAccounts.lineUserId,
      notificationEnabled: subscriptions.notificationEnabled,
      createdAt: subscriptions.createdAt,
    })
    .from(subscriptions)
    .leftJoin(lineAccounts, eq(lineAccounts.userId, subscriptions.userId))
    .where(eq(subscriptions.schoolId, schoolId))
    .orderBy(desc(subscriptions.createdAt));
}

/**
 * 学年・クラスで絞った購読者（セグメント配信 / M19）。
 * 学校を購読 かつ その学校の student_profiles が指定学年[/組]に一致するユーザーのみ。
 * profile 未登録者は対象外（＝欠席フローで登録済みの家庭のみ届く）。
 */
export async function listSubscribersBySchoolFiltered(
  db: Db,
  schoolId: string,
  filter: { grade?: string; className?: string },
): Promise<{ userId: string }[]> {
  const conds = [eq(subscriptions.schoolId, schoolId), eq(studentProfiles.schoolId, schoolId)];
  if (filter.grade) conds.push(eq(studentProfiles.grade, filter.grade));
  if (filter.className) conds.push(eq(studentProfiles.className, filter.className));
  const rows = await db
    .selectDistinct({ userId: subscriptions.userId })
    .from(subscriptions)
    .innerJoin(studentProfiles, eq(studentProfiles.ownerUserId, subscriptions.userId))
    .where(and(...conds));
  return rows;
}

/** 通知有効な購読ユーザーを学校単位で取得（M7 通知配信）。 */
export async function listEnabledSubscribersBySchool(db: Db, schoolId: string): Promise<SubscriptionRow[]> {
  return db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.schoolId, schoolId), eq(subscriptions.notificationEnabled, true)));
}
