import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../client.ts";
import { flowSchedules, flowTemplates } from "../schema.ts";
import type { FlowTemplate } from "./flow-templates.ts";

export interface FlowSchedule {
  id: string;
  templateId: string;
  time: string; // "HH:MM"
  daysOfWeek: number[]; // 0=日..6=土、空配列は毎日
  enabled: boolean;
  lastRunAt: Date | null;
  lastRunDate: string | null;
  createdAt: Date;
}

type Row = typeof flowSchedules.$inferSelect;
const toSchedule = (r: Row): FlowSchedule => ({
  id: r.id,
  templateId: r.templateId,
  time: r.time,
  daysOfWeek: (r.daysOfWeek as number[]) ?? [],
  enabled: r.enabled,
  lastRunAt: r.lastRunAt,
  lastRunDate: r.lastRunDate,
  createdAt: r.createdAt,
});

export interface FlowScheduleInput {
  templateId: string;
  time: string;
  daysOfWeek: number[];
  enabled?: boolean;
}

export async function listSchedules(db: Db, templateId?: string): Promise<FlowSchedule[]> {
  const rows = templateId
    ? await db.select().from(flowSchedules).where(eq(flowSchedules.templateId, templateId)).orderBy(desc(flowSchedules.createdAt))
    : await db.select().from(flowSchedules).orderBy(desc(flowSchedules.createdAt));
  return rows.map(toSchedule);
}

export async function createSchedule(db: Db, input: FlowScheduleInput): Promise<FlowSchedule> {
  const rows = await db.insert(flowSchedules).values(input).returning();
  const row = rows[0];
  if (!row) throw new Error("failed to create flow schedule");
  return toSchedule(row);
}

export async function updateSchedule(
  db: Db,
  id: string,
  patch: Partial<Pick<FlowScheduleInput, "time" | "daysOfWeek" | "enabled">>,
): Promise<FlowSchedule> {
  const rows = await db.update(flowSchedules).set(patch).where(eq(flowSchedules.id, id)).returning();
  const row = rows[0];
  if (!row) throw new Error("flow schedule not found");
  return toSchedule(row);
}

export async function deleteSchedule(db: Db, id: string): Promise<void> {
  await db.delete(flowSchedules).where(eq(flowSchedules.id, id));
}

/**
 * 実行対象のスケジュール（＋テンプレート）を取得。
 * time 一致・曜日一致（空配列は毎日）・当日未実行（lastRunDate != targetDate）・enabled のもの。
 */
export async function listDueSchedules(
  db: Db,
  params: { time: string; weekday: number; targetDate: string },
): Promise<{ schedule: FlowSchedule; template: FlowTemplate }[]> {
  const rows = await db
    .select()
    .from(flowSchedules)
    .innerJoin(flowTemplates, eq(flowTemplates.id, flowSchedules.templateId))
    .where(and(eq(flowSchedules.enabled, true), eq(flowSchedules.time, params.time)));

  const due: { schedule: FlowSchedule; template: FlowTemplate }[] = [];
  for (const r of rows) {
    const schedule = toSchedule(r.flow_schedules);
    if (schedule.lastRunDate === params.targetDate) continue; // 当日実行済み
    if (schedule.daysOfWeek.length > 0 && !schedule.daysOfWeek.includes(params.weekday)) continue;
    const t = r.flow_templates;
    due.push({
      schedule,
      template: {
        id: t.id,
        name: t.name,
        allUsers: t.allUsers,
        query: t.query as FlowTemplate["query"],
        steps: t.steps as FlowTemplate["steps"],
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      },
    });
  }
  return due;
}

/** 実行済みを記録（同日二重実行防止）。 */
export async function markScheduleRun(db: Db, id: string, at: Date, targetDate: string): Promise<void> {
  await db.update(flowSchedules).set({ lastRunAt: at, lastRunDate: targetDate }).where(eq(flowSchedules.id, id));
}
