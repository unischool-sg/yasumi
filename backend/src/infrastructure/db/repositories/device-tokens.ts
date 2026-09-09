import { and, eq } from "drizzle-orm";
import type { Db } from "../client.ts";
import { deviceTokens } from "../schema.ts";

export type DeviceTokenRow = typeof deviceTokens.$inferSelect;

/**
 * デバイストークンを登録/更新。token を一意キーに upsert し、再ログインや端末付け替えでも
 * userId/platform/lastSeenAt を最新に保つ（1ユーザー多デバイス）。
 */
export async function upsertDeviceToken(
  db: Db,
  input: { userId: string; platform: string; token: string; now?: Date },
): Promise<DeviceTokenRow> {
  const now = input.now ?? new Date();
  const rows = await db
    .insert(deviceTokens)
    .values({ userId: input.userId, platform: input.platform, token: input.token, lastSeenAt: now })
    .onConflictDoUpdate({
      target: deviceTokens.token,
      set: { userId: input.userId, platform: input.platform, lastSeenAt: now },
    })
    .returning();
  const row = rows[0];
  if (!row) throw new Error("failed to upsert device token");
  return row;
}

/** 内部ユーザーの全デバイストークン文字列（通知送信に使う）。 */
export async function listTokensByUser(db: Db, userId: string): Promise<string[]> {
  const rows = await db
    .select({ token: deviceTokens.token })
    .from(deviceTokens)
    .where(eq(deviceTokens.userId, userId));
  return rows.map((r) => r.token);
}

/** デバイストークンを削除（ログアウト/無効化時）。本人のもののみ。 */
export async function removeDeviceToken(db: Db, userId: string, token: string): Promise<void> {
  await db
    .delete(deviceTokens)
    .where(and(eq(deviceTokens.userId, userId), eq(deviceTokens.token, token)));
}
