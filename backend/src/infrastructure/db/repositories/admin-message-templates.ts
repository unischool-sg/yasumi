import { desc, eq } from "drizzle-orm";
import type { Db } from "../client.ts";
import { adminMessageTemplates } from "../schema.ts";

export type AdminMessageTemplateRow = typeof adminMessageTemplates.$inferSelect;

export async function createTemplate(db: Db, input: { title: string; body: string }): Promise<AdminMessageTemplateRow> {
  const rows = await db.insert(adminMessageTemplates).values(input).returning();
  const row = rows[0];
  if (!row) throw new Error("failed to create admin template");
  return row;
}

export async function listTemplates(db: Db): Promise<AdminMessageTemplateRow[]> {
  return db.select().from(adminMessageTemplates).orderBy(desc(adminMessageTemplates.createdAt));
}

export async function deleteTemplate(db: Db, id: string): Promise<void> {
  await db.delete(adminMessageTemplates).where(eq(adminMessageTemplates.id, id));
}
