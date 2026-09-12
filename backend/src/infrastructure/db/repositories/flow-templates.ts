import type { FlowAudienceQuery, FlowStep } from "@yasumi/shared";
import { desc, eq } from "drizzle-orm";
import type { Db } from "../client.ts";
import { flowSchedules, flowTemplates } from "../schema.ts";

export interface FlowTemplate {
  id: string;
  name: string;
  allUsers: boolean;
  query: FlowAudienceQuery;
  steps: FlowStep[];
  createdAt: Date;
  updatedAt: Date;
}

type Row = typeof flowTemplates.$inferSelect;
const toTemplate = (r: Row): FlowTemplate => ({
  id: r.id,
  name: r.name,
  allUsers: r.allUsers,
  query: r.query as FlowAudienceQuery,
  steps: r.steps as FlowStep[],
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

export interface FlowTemplateInput {
  name: string;
  allUsers: boolean;
  query: FlowAudienceQuery;
  steps: FlowStep[];
}

export async function listTemplates(db: Db): Promise<FlowTemplate[]> {
  const rows = await db.select().from(flowTemplates).orderBy(desc(flowTemplates.createdAt));
  return rows.map(toTemplate);
}

export async function getTemplate(db: Db, id: string): Promise<FlowTemplate | undefined> {
  const rows = await db.select().from(flowTemplates).where(eq(flowTemplates.id, id)).limit(1);
  return rows[0] ? toTemplate(rows[0]) : undefined;
}

export async function createTemplate(db: Db, input: FlowTemplateInput): Promise<FlowTemplate> {
  const rows = await db.insert(flowTemplates).values(input).returning();
  const row = rows[0];
  if (!row) throw new Error("failed to create flow template");
  return toTemplate(row);
}

export async function updateTemplate(db: Db, id: string, input: FlowTemplateInput): Promise<FlowTemplate> {
  const rows = await db
    .update(flowTemplates)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(flowTemplates.id, id))
    .returning();
  const row = rows[0];
  if (!row) throw new Error("flow template not found");
  return toTemplate(row);
}

export async function deleteTemplate(db: Db, id: string): Promise<void> {
  // スケジュールも合わせて削除（FK 制約なしのため明示）。
  await db.delete(flowSchedules).where(eq(flowSchedules.templateId, id));
  await db.delete(flowTemplates).where(eq(flowTemplates.id, id));
}
