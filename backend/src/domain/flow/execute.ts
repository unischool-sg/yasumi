import { type AudienceUser, type FlowAudienceQuery, type FlowStep, matchesAudienceQuery } from "@yasumi/shared";
import type { Db } from "../../infrastructure/db/client.ts";
import * as flagsRepo from "../../infrastructure/db/repositories/flags.ts";
import * as subsRepo from "../../infrastructure/db/repositories/subscriptions.ts";
import * as usersRepo from "../../infrastructure/db/repositories/users.ts";
import { type NotifyDeps, notifyUser } from "../notification/dispatch.ts";

export interface FlowDefinition {
  allUsers: boolean;
  query: FlowAudienceQuery;
  steps: FlowStep[];
}

export interface FlowExecuteDeps extends NotifyDeps {
  now?: () => Date;
}

export interface FlowStepResult {
  step: FlowStep;
  sent?: number;
  total?: number;
}

export interface FlowRunResult {
  audienceIds: string[];
  results: FlowStepResult[];
}

/** 対象条件に合致する userId を解決する（allUsers なら全員）。 */
export async function resolveAudience(db: Db, def: FlowDefinition, nowMs: number): Promise<string[]> {
  if (def.allUsers) return usersRepo.listAllUserIds(db);
  const rows = await usersRepo.listUsers(db, { limit: 1000 });
  const ids = rows.map((r) => r.id);
  const [flags, subs] = await Promise.all([
    flagsRepo.listByUsers(db, ids),
    subsRepo.listSubscribedSchoolsByUsers(db, ids),
  ]);
  const audience: AudienceUser[] = rows.map((r) => ({
    id: r.id,
    lineUserId: r.lineUserId,
    createdAt: r.createdAt.toISOString(),
    subscriptionCount: r.subscriptionCount,
    flags: flags.get(r.id) ?? [],
    subscribedSchools: subs.get(r.id) ?? [],
  }));
  return audience.filter((u) => matchesAudienceQuery(u, def.query, nowMs)).map((u) => u.id);
}

/**
 * フローをサーバー側で実行する（手動実行・cron 共通）。
 * ステップを上から順に: send=メッセージ送信 / addFlag=フラグ付与 / removeFlag=フラグ解除。
 */
export async function executeFlow(deps: FlowExecuteDeps, def: FlowDefinition): Promise<FlowRunResult> {
  const nowMs = (deps.now?.() ?? new Date()).getTime();
  const audienceIds = await resolveAudience(deps.db, def, nowMs);
  const notifyDeps: NotifyDeps = {
    db: deps.db,
    ...(deps.notificationProvider ? { notificationProvider: deps.notificationProvider } : {}),
    ...(deps.pushProvider ? { pushProvider: deps.pushProvider } : {}),
  };

  const results: FlowStepResult[] = [];
  for (const step of def.steps) {
    if (step.type === "send") {
      const text = step.text ?? "";
      let sent = 0;
      if (text.trim()) {
        for (const uid of audienceIds) {
          if (await notifyUser(notifyDeps, uid, text)) sent++;
        }
      }
      results.push({ step, sent, total: audienceIds.length });
    } else if (step.type === "addFlag" && step.flag) {
      if (audienceIds.length > 0) await flagsRepo.assign(deps.db, audienceIds, step.flag);
      results.push({ step, total: audienceIds.length });
    } else if (step.type === "removeFlag" && step.flag) {
      if (audienceIds.length > 0) await flagsRepo.unassign(deps.db, audienceIds, step.flag);
      results.push({ step, total: audienceIds.length });
    } else {
      results.push({ step, total: audienceIds.length });
    }
  }
  return { audienceIds, results };
}
