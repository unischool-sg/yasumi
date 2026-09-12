import { describeFlowStep } from "@yasumi/shared";
import { type FlowExecuteDeps, type FlowRunResult, executeFlow } from "../domain/flow/execute.ts";
import type { Db } from "../infrastructure/db/client.ts";
import { postDiscordMessage } from "../infrastructure/discord/notify.ts";
import * as schedulesRepo from "../infrastructure/db/repositories/flow-schedules.ts";
import type { FlowTemplate } from "../infrastructure/db/repositories/flow-templates.ts";
import { jstDateString, jstHhmm, jstWeekday } from "../shared/jst.ts";

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export interface RunFlowsDeps extends FlowExecuteDeps {
  db: Db;
  /** cron 実行ログの送信先（未設定なら送らない）。 */
  discordFlowWebhookUrl?: string;
  /** 管理画面のベースURL（対象者/テンプレのリンク生成用）。 */
  adminBaseUrl?: string;
  fetchFn?: FetchFn;
}

export interface RunFlowsSummary {
  triggeredAt: string;
  time: string;
  targetDate: string;
  schedulesDue: number;
  flowsRun: number;
}

const MAX_LISTED_USERS = 25;

/** cron 実行ログを Discord に送る（対象者一覧＋操作内容＋テンプレURL）。 */
async function postFlowLog(
  deps: RunFlowsDeps,
  template: FlowTemplate,
  run: FlowRunResult,
): Promise<void> {
  if (!deps.discordFlowWebhookUrl) return;
  const adminBase = deps.adminBaseUrl || "https://yasumi-admin.unischool.jp";
  const templateUrl = `${adminBase}/flows`;

  const lines: string[] = [];
  lines.push("🤖 **フロー定期実行**");
  lines.push(`テンプレート: **${template.name}**（<${templateUrl}>）`);
  lines.push("");
  lines.push("**操作内容**");
  template.steps.forEach((st, i) => lines.push(`${i + 1}. ${describeFlowStep(st)}`));
  run.results
    .filter((r) => r.step.type === "send")
    .forEach((r) => lines.push(`　→ 送信結果: ${r.sent}/${r.total}`));
  lines.push("");
  lines.push(`**対象者（${run.audienceIds.length}名）**`);
  for (const uid of run.audienceIds.slice(0, MAX_LISTED_USERS)) {
    lines.push(`・<${adminBase}/users/${uid}>`);
  }
  if (run.audienceIds.length > MAX_LISTED_USERS) {
    lines.push(`…他 ${run.audienceIds.length - MAX_LISTED_USERS} 名`);
  }

  await postDiscordMessage(deps.discordFlowWebhookUrl, lines.join("\n"), deps.fetchFn ? { fetchFn: deps.fetchFn } : {});
}

/**
 * 定期実行スケジュールを評価してフローを走らせる。
 * 既存 cron（30分刻み）の tick から /api/internal/run-flows 経由で呼ばれる。
 */
export async function runFlows(deps: RunFlowsDeps, params: { triggeredAt: Date }): Promise<RunFlowsSummary> {
  const { triggeredAt } = params;
  const time = jstHhmm(triggeredAt);
  const targetDate = jstDateString(triggeredAt);
  const weekday = jstWeekday(triggeredAt);

  const summary: RunFlowsSummary = {
    triggeredAt: triggeredAt.toISOString(),
    time,
    targetDate,
    schedulesDue: 0,
    flowsRun: 0,
  };

  const due = await schedulesRepo.listDueSchedules(deps.db, { time, weekday, targetDate });
  summary.schedulesDue = due.length;

  for (const { schedule, template } of due) {
    // 二重実行防止: 先に実行済みを記録してから走らせる。
    await schedulesRepo.markScheduleRun(deps.db, schedule.id, triggeredAt, targetDate);
    try {
      const run = await executeFlow(deps, {
        allUsers: template.allUsers,
        query: template.query,
        steps: template.steps,
      });
      summary.flowsRun++;
      await postFlowLog(deps, template, run);
    } catch (e) {
      console.error("[run-flows] execute error", template.id, e);
    }
  }

  return summary;
}
