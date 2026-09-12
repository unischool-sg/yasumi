import { count, desc, eq } from "drizzle-orm";
import type { Db } from "../client.ts";
import { lineAccounts, subscriptions, users } from "../schema.ts";

/**
 * LINE ユーザーIDから内部ユーザーを取得。無ければ users + line_accounts を作成（PRD §21, §55）。
 */
export async function findOrCreateByLineUserId(db: Db, lineUserId: string): Promise<{ userId: string }> {
  const existing = await db
    .select({ userId: lineAccounts.userId })
    .from(lineAccounts)
    .where(eq(lineAccounts.lineUserId, lineUserId))
    .limit(1);
  const found = existing[0];
  if (found) return { userId: found.userId };

  return db.transaction(async (tx) => {
    const inserted = await tx.insert(users).values({}).returning({ id: users.id });
    const user = inserted[0];
    if (!user) throw new Error("failed to create user");
    await tx.insert(lineAccounts).values({ userId: user.id, lineUserId });
    return { userId: user.id };
  });
}

/** 管理画面: ユーザー一覧（内部ID + LINEユーザーID + 作成日、新しい順）。 */
export async function listUsers(
  db: Db,
  opts: { limit?: number; offset?: number } = {},
): Promise<{ id: string; lineUserId: string | null; createdAt: Date; subscriptionCount: number }[]> {
  return db
    .select({
      id: users.id,
      lineUserId: lineAccounts.lineUserId,
      createdAt: users.createdAt,
      subscriptionCount: count(subscriptions.schoolId),
    })
    .from(users)
    .leftJoin(lineAccounts, eq(lineAccounts.userId, users.id))
    .leftJoin(subscriptions, eq(subscriptions.userId, users.id))
    .groupBy(users.id, lineAccounts.lineUserId)
    .orderBy(desc(users.createdAt))
    .limit(opts.limit ?? 100)
    .offset(opts.offset ?? 0);
}

export async function countUsers(db: Db): Promise<number> {
  const rows = await db.select({ id: users.id }).from(users);
  return rows.length;
}

/** 全ユーザーの内部ID（一斉送信用）。 */
export async function listAllUserIds(db: Db): Promise<string[]> {
  const rows = await db.select({ id: users.id }).from(users);
  return rows.map((r) => r.id);
}

/** 内部ユーザーの LINE ユーザーIDを取得（通知送信に使う）。 */
export async function getLineUserId(db: Db, userId: string): Promise<string | undefined> {
  const rows = await db
    .select({ lineUserId: lineAccounts.lineUserId })
    .from(lineAccounts)
    .where(eq(lineAccounts.userId, userId))
    .limit(1);
  return rows[0]?.lineUserId;
}
