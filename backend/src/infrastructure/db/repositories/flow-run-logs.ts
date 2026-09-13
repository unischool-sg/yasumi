import { desc, inArray, lt } from "drizzle-orm";
import { eq } from "drizzle-orm";
import type { Db } from "../client.ts";
import { flowRunLogs } from "../schema.ts";

/** 実行ログに残すステップ結果（FlowStepResult のスナップショット）。 */
export interface FlowRunLogStep {
  type: string;
  flag?: string | null;
  sent?: number | null;
  total?: number | null;
}

export interface FlowRunLogInput {
  templateId: string | null;
  templateName: string;
  trigger: "manual" | "schedule" | "event";
  scheduleId?: string | null;
  eventType?: string | null;
  audienceCount: number;
  results: FlowRunLogStep[];
  status: "success" | "error";
  error?: string | null;
}

export type FlowRunLogRow = typeof flowRunLogs.$inferSelect;

/** 実行ログを1件記録。 */
export async function recordFlowRun(db: Db, input: FlowRunLogInput): Promise<FlowRunLogRow> {
  const rows = await db
    .insert(flowRunLogs)
    .values({
      templateId: input.templateId,
      templateName: input.templateName,
      trigger: input.trigger,
      scheduleId: input.scheduleId ?? null,
      eventType: input.eventType ?? null,
      audienceCount: input.audienceCount,
      results: input.results,
      status: input.status,
      error: input.error ?? null,
    })
    .returning();
  return rows[0]!;
}

/** 管理画面: 実行ログ一覧（新しい順・任意でテンプレ絞り込み）。 */
export async function listFlowRunLogs(
  db: Db,
  filter: { templateId?: string } = {},
  limit = 200,
): Promise<FlowRunLogRow[]> {
  const base = db.select().from(flowRunLogs);
  const q = filter.templateId ? base.where(eq(flowRunLogs.templateId, filter.templateId)) : base;
  return q.orderBy(desc(flowRunLogs.createdAt)).limit(limit);
}

/** retention: cutoff より古いログを古い順に取得（S3 退避対象）。 */
export async function listFlowRunLogsBefore(db: Db, before: Date, limit = 5000): Promise<FlowRunLogRow[]> {
  return db
    .select()
    .from(flowRunLogs)
    .where(lt(flowRunLogs.createdAt, before))
    .orderBy(flowRunLogs.createdAt)
    .limit(limit);
}

/** retention: 指定 ID 群を削除。 */
export async function deleteFlowRunLogsByIds(db: Db, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.delete(flowRunLogs).where(inArray(flowRunLogs.id, ids));
}
