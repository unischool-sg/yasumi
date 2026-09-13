import type { FlowEventType, FlowTriggerAudienceMode } from "@yasumi/shared";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../client.ts";
import { flowEventTriggers, flowTemplates } from "../schema.ts";
import type { FlowTemplate } from "./flow-templates.ts";

export interface FlowEventTrigger {
  id: string;
  templateId: string;
  eventType: FlowEventType;
  audienceMode: FlowTriggerAudienceMode;
  enabled: boolean;
  createdAt: Date;
}

type Row = typeof flowEventTriggers.$inferSelect;
const toTrigger = (r: Row): FlowEventTrigger => ({
  id: r.id,
  templateId: r.templateId,
  eventType: r.eventType as FlowEventType,
  audienceMode: r.audienceMode as FlowTriggerAudienceMode,
  enabled: r.enabled,
  createdAt: r.createdAt,
});

const toTemplate = (t: typeof flowTemplates.$inferSelect): FlowTemplate => ({
  id: t.id,
  name: t.name,
  allUsers: t.allUsers,
  query: t.query as FlowTemplate["query"],
  steps: t.steps as FlowTemplate["steps"],
  createdAt: t.createdAt,
  updatedAt: t.updatedAt,
});

export interface FlowEventTriggerInput {
  templateId: string;
  eventType: FlowEventType;
  audienceMode: FlowTriggerAudienceMode;
  enabled?: boolean;
}

export async function listTriggers(db: Db, templateId?: string): Promise<FlowEventTrigger[]> {
  const rows = templateId
    ? await db
        .select()
        .from(flowEventTriggers)
        .where(eq(flowEventTriggers.templateId, templateId))
        .orderBy(desc(flowEventTriggers.createdAt))
    : await db.select().from(flowEventTriggers).orderBy(desc(flowEventTriggers.createdAt));
  return rows.map(toTrigger);
}

export async function createTrigger(db: Db, input: FlowEventTriggerInput): Promise<FlowEventTrigger> {
  const rows = await db.insert(flowEventTriggers).values(input).returning();
  const row = rows[0];
  if (!row) throw new Error("failed to create flow event trigger");
  return toTrigger(row);
}

export async function updateTrigger(
  db: Db,
  id: string,
  patch: Partial<Pick<FlowEventTriggerInput, "eventType" | "audienceMode" | "enabled">>,
): Promise<FlowEventTrigger> {
  const rows = await db.update(flowEventTriggers).set(patch).where(eq(flowEventTriggers.id, id)).returning();
  const row = rows[0];
  if (!row) throw new Error("flow event trigger not found");
  return toTrigger(row);
}

export async function deleteTrigger(db: Db, id: string): Promise<void> {
  await db.delete(flowEventTriggers).where(eq(flowEventTriggers.id, id));
}

/** 指定イベントで発火する有効なトリガー（＋テンプレート）を取得。 */
export async function listEnabledByEvent(
  db: Db,
  eventType: FlowEventType,
): Promise<{ trigger: FlowEventTrigger; template: FlowTemplate }[]> {
  const rows = await db
    .select()
    .from(flowEventTriggers)
    .innerJoin(flowTemplates, eq(flowTemplates.id, flowEventTriggers.templateId))
    .where(and(eq(flowEventTriggers.enabled, true), eq(flowEventTriggers.eventType, eventType)));
  return rows.map((r) => ({ trigger: toTrigger(r.flow_event_triggers), template: toTemplate(r.flow_templates) }));
}
