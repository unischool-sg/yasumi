import { eq } from "drizzle-orm";
import type { Db } from "../client.ts";
import { messageConfirmations } from "../schema.ts";

/** 確認を記録（同一 message×user は冪等）。 */
export async function addConfirmation(db: Db, messageId: string, userId: string): Promise<void> {
  await db
    .insert(messageConfirmations)
    .values({ messageId, userId })
    .onConflictDoNothing({ target: [messageConfirmations.messageId, messageConfirmations.userId] });
}

export async function countByMessage(db: Db, messageId: string): Promise<number> {
  const rows = await db
    .select({ userId: messageConfirmations.userId })
    .from(messageConfirmations)
    .where(eq(messageConfirmations.messageId, messageId));
  return rows.length;
}
