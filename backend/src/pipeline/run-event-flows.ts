import type { FlowEventType, FlowTriggerAudienceMode } from "@yasumi/shared";
import { type FlowExecuteDeps, executeFlow } from "../domain/flow/execute.ts";
import type { Db } from "../infrastructure/db/client.ts";
import * as triggersRepo from "../infrastructure/db/repositories/flow-event-triggers.ts";
import { recordFlowRun } from "../infrastructure/db/repositories/flow-run-logs.ts";
import * as schoolsRepo from "../infrastructure/db/repositories/schools.ts";
import * as subsRepo from "../infrastructure/db/repositories/subscriptions.ts";
import { toLogSteps } from "./run-flows.ts";

export interface EventContext {
  eventType: FlowEventType;
  /** イベントを起こした本人（trigger_user モード用）。 */
  userId?: string;
  /** 対象校（school_subscribers モード用）。 */
  schoolId?: string;
}

export interface RunEventFlowsDeps extends FlowExecuteDeps {
  db: Db;
  /** 握りつぶすエラーの通知（console.error＋Discord）。未設定なら console.error のみ。 */
  reportError?: (context: string, err: unknown) => void;
}

export interface RunEventFlowsSummary {
  eventType: FlowEventType;
  triggersMatched: number;
  flowsRun: number;
}

/** trigger_user / school_subscribers の対象 userId を解決する（query は executeFlow に委ねる）。 */
async function resolveEventAudience(
  db: Db,
  mode: Exclude<FlowTriggerAudienceMode, "query">,
  ctx: EventContext,
): Promise<string[] | null> {
  if (mode === "trigger_user") return ctx.userId ? [ctx.userId] : null;
  // school_subscribers
  if (!ctx.schoolId) return null;
  const subs = await subsRepo.listEnabledSubscribersBySchool(db, ctx.schoolId);
  return subs.map((s) => s.userId);
}

/**
 * イベント発火時に、そのイベントに紐づく有効なトリガーのフローを実行する。
 * 各種イベント用の内部エンドポイント（/api/internal/run-event-flows）から呼ばれる。
 */
export async function runEventFlows(deps: RunEventFlowsDeps, ctx: EventContext): Promise<RunEventFlowsSummary> {
  const report = deps.reportError ?? ((context: string, err: unknown) => console.error(`[error] ${context}`, err));
  const summary: RunEventFlowsSummary = { eventType: ctx.eventType, triggersMatched: 0, flowsRun: 0 };

  const triggers = await triggersRepo.listEnabledByEvent(deps.db, ctx.eventType);
  summary.triggersMatched = triggers.length;

  // {{school}} 用に対象校名を一度だけ解決（schoolId があるイベントのみ）。
  const schoolName = ctx.schoolId
    ? (await schoolsRepo.findSchoolById(deps.db, ctx.schoolId).catch(() => null))?.name
    : undefined;

  for (const { trigger, template } of triggers) {
    try {
      // query モードは executeFlow に query 解決させる。それ以外は明示 audience。
      let audienceIds: string[] | undefined;
      if (trigger.audienceMode !== "query") {
        const resolved = await resolveEventAudience(deps.db, trigger.audienceMode, ctx);
        if (resolved === null) continue; // このイベントに必要な文脈（userId/schoolId）が無い
        if (resolved.length === 0) {
          // 対象0でもログは残す（実行はなし）。
          await recordFlowRun(deps.db, {
            templateId: template.id,
            templateName: template.name,
            trigger: "event",
            eventType: ctx.eventType,
            audienceCount: 0,
            results: [],
            status: "success",
          }).catch((e) => report(`run-event-flows log (${ctx.eventType}/${template.id})`, e));
          continue;
        }
        audienceIds = resolved;
      }

      const run = await executeFlow(deps, {
        allUsers: template.allUsers,
        query: template.query,
        steps: template.steps,
        ...(audienceIds ? { audienceIds } : {}),
        ...(schoolName ? { schoolName } : {}),
      });
      summary.flowsRun++;
      await recordFlowRun(deps.db, {
        templateId: template.id,
        templateName: template.name,
        trigger: "event",
        eventType: ctx.eventType,
        audienceCount: run.audienceIds.length,
        results: toLogSteps(run.results),
        status: "success",
      }).catch((e) => report(`run-event-flows log (${ctx.eventType}/${template.id})`, e));
    } catch (e) {
      report(`run-event-flows execute (${ctx.eventType}/${template.id})`, e);
      await recordFlowRun(deps.db, {
        templateId: template.id,
        templateName: template.name,
        trigger: "event",
        eventType: ctx.eventType,
        audienceCount: 0,
        results: [],
        status: "error",
        error: e instanceof Error ? e.message : String(e),
      }).catch((err) => report(`run-event-flows error-log (${ctx.eventType}/${template.id})`, err));
    }
  }

  return summary;
}
