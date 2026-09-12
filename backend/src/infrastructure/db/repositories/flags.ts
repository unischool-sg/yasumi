import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "../client.ts";
import { flagDefs, userFlags } from "../schema.ts";

export type FlagDefRow = typeof flagDefs.$inferSelect;

export async function listDefs(db: Db): Promise<FlagDefRow[]> {
  return db.select().from(flagDefs).orderBy(desc(flagDefs.createdAt));
}

export async function createDef(db: Db, input: { name: string; color?: string | null }): Promise<FlagDefRow> {
  const rows = await db
    .insert(flagDefs)
    .values({ name: input.name, color: input.color ?? null })
    .onConflictDoNothing({ target: flagDefs.name })
    .returning();
  return rows[0] ?? { name: input.name, color: input.color ?? null, createdAt: new Date() };
}

export async function deleteDef(db: Db, name: string): Promise<void> {
  await db.delete(flagDefs).where(eq(flagDefs.name, name));
  await db.delete(userFlags).where(eq(userFlags.name, name)); // 付与も掃除
}

/** 複数ユーザーへ一括付与（冪等）。付与件数を返す。 */
export async function assign(db: Db, userIds: string[], name: string): Promise<number> {
  if (userIds.length === 0) return 0;
  const rows = await db
    .insert(userFlags)
    .values(userIds.map((userId) => ({ userId, name })))
    .onConflictDoNothing({ target: [userFlags.userId, userFlags.name] })
    .returning();
  return rows.length;
}

/** 複数ユーザーから一括解除。 */
export async function unassign(db: Db, userIds: string[], name: string): Promise<void> {
  if (userIds.length === 0) return;
  await db.delete(userFlags).where(and(inArray(userFlags.userId, userIds), eq(userFlags.name, name)));
}

/** 指定ユーザー群のフラグを { userId -> name[] } で取得。 */
export async function listByUsers(db: Db, userIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (userIds.length === 0) return map;
  const rows = await db
    .select({ userId: userFlags.userId, name: userFlags.name })
    .from(userFlags)
    .where(inArray(userFlags.userId, userIds));
  for (const r of rows) {
    const arr = map.get(r.userId) ?? [];
    arr.push(r.name);
    map.set(r.userId, arr);
  }
  return map;
}
