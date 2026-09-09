import { eq } from "drizzle-orm";
import type { Db } from "../client.ts";
import { lineAccounts, users } from "../schema.ts";

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

/** 内部ユーザーの LINE ユーザーIDを取得（通知送信に使う）。 */
export async function getLineUserId(db: Db, userId: string): Promise<string | undefined> {
  const rows = await db
    .select({ lineUserId: lineAccounts.lineUserId })
    .from(lineAccounts)
    .where(eq(lineAccounts.userId, userId))
    .limit(1);
  return rows[0]?.lineUserId;
}
