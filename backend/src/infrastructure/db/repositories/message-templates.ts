import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../client.ts";
import { messageTemplates } from "../schema.ts";

export type MessageTemplateRow = typeof messageTemplates.$inferSelect;

export async function createTemplate(
  db: Db,
  input: { schoolId: string; title: string; category: "emergency" | "announcement"; body: string },
): Promise<MessageTemplateRow> {
  const rows = await db.insert(messageTemplates).values(input).returning();
  const row = rows[0];
  if (!row) throw new Error("failed to create template");
  return row;
}

export async function listBySchool(db: Db, schoolId: string): Promise<MessageTemplateRow[]> {
  return db
    .select()
    .from(messageTemplates)
    .where(eq(messageTemplates.schoolId, schoolId))
    .orderBy(desc(messageTemplates.createdAt));
}

/** テナント境界を守る削除（school を跨がない）。 */
export async function deleteInSchool(db: Db, schoolId: string, id: string): Promise<void> {
  await db
    .delete(messageTemplates)
    .where(and(eq(messageTemplates.id, id), eq(messageTemplates.schoolId, schoolId)));
}
