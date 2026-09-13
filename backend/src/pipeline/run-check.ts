import type { CheckResult, Warning } from "@yasumi/shared";
import { buildClosureDraftText, isClosureResult } from "../domain/closure-draft.ts";
import { evaluateSchoolRule } from "../domain/rule/evaluate.ts";
import { buildNotificationText } from "../domain/notification/messages.ts";
import type { NotificationProvider } from "../domain/notification/provider.ts";
import { shouldNotify } from "../domain/notification/provider.ts";
import { isPlanActive } from "../domain/plan.ts";
import type { WarningProvider } from "../domain/warning/provider.ts";
import { officeCodesForArea } from "../infrastructure/jma/jma-warning-provider.ts";
import type { Db } from "../infrastructure/db/client.ts";
import * as closureDraftsRepo from "../infrastructure/db/repositories/closure-drafts.ts";
import * as schoolsRepo from "../infrastructure/db/repositories/schools.ts";
import * as cfg from "../infrastructure/db/repositories/school-config.ts";
import * as deviceTokensRepo from "../infrastructure/db/repositories/device-tokens.ts";
import * as notificationsRepo from "../infrastructure/db/repositories/notifications.ts";
import * as rulesRepo from "../infrastructure/db/repositories/rules.ts";
import * as subscriptionsRepo from "../infrastructure/db/repositories/subscriptions.ts";
import * as usersRepo from "../infrastructure/db/repositories/users.ts";
import * as warningChecksRepo from "../infrastructure/db/repositories/warning-checks.ts";
import { jstDateString, jstHhmm } from "../shared/jst.ts";

export interface RunCheckDeps {
  db: Db;
  warningProvider: WarningProvider;
  /** LINE プッシュ（デバイストークン未登録ユーザーへのフォールバック）。 */
  notificationProvider: NotificationProvider;
  /** FCM プッシュ（デバイストークン登録済みユーザーへ。無料・優先）。未設定なら LINE のみ。 */
  pushProvider?: NotificationProvider;
  /** 運用アラート送信（JMA 取得失敗など）。未設定なら送らない。失敗しても主処理は止めない。 */
  alert?: (message: string) => Promise<void>;
  /** イベント連動フローの発火（休校判定など）。best-effort。 */
  emitEvent?: (event: { eventType: "judgment.closure"; schoolId: string }) => void;
  now?: () => Date;
}

export interface RunCheckSummary {
  triggeredAt: string;
  checkTime: string;
  targetDate: string;
  rulesProcessed: number;
  checksCreated: number;
  notificationsSent: number;
  fetchFailed: boolean;
  errors: number;
}

/**
 * 判定パイプライン（PRD §26, §34〜§36, §57 / backend/CRON.md §6）。
 * cron から app.fetch("/api/internal/run-check") 経由で呼ばれる。
 * 純粋関数ではないが、依存注入でテスト可能。
 */
export async function runCheck(
  deps: RunCheckDeps,
  params: { triggeredAt: Date },
): Promise<RunCheckSummary> {
  const now = deps.now ?? (() => new Date());
  const { triggeredAt } = params;
  const checkTime = jstHhmm(triggeredAt);
  const targetDate = jstDateString(triggeredAt);

  const summary: RunCheckSummary = {
    triggeredAt: triggeredAt.toISOString(),
    checkTime,
    targetDate,
    rulesProcessed: 0,
    checksCreated: 0,
    notificationsSent: 0,
    fetchFailed: false,
    errors: 0,
  };

  // 1. 現在時刻(HH:MM)に該当するルールを全学校横断で取得
  const rules = await rulesRepo.listRulesByCheckTime(deps.db, checkTime);
  if (rules.length === 0) return summary;

  // 2. 対象学校の engine School を構築し、必要地域を集約
  const schoolIds = [...new Set(rules.map((r) => r.schoolId))];
  const engineSchools = new Map<string, Awaited<ReturnType<typeof cfg.buildEngineSchool>>>();
  const allAreaCodes = new Set<string>();
  for (const schoolId of schoolIds) {
    const school = await cfg.buildEngineSchool(deps.db, schoolId);
    engineSchools.set(schoolId, school);
    for (const code of school?.areaCodes ?? []) allAreaCodes.add(code);
  }

  // 3. 警報を一括取得（キャッシュ/バッチ §33）。取得失敗した office の学校のみ UNKNOWN に倒す（§51）
  let warnings: Warning[] = [];
  const failedOfficeCodes = new Set<string>();
  try {
    const res = await deps.warningProvider.getActiveWarnings([...allAreaCodes]);
    warnings = res.warnings;
    for (const code of res.failedOfficeCodes) failedOfficeCodes.add(code);
  } catch (e) {
    // 想定外（provider が例外を投げた）→ 安全側に倒し、全対象 office を失敗扱い。
    console.error("[run-check] warning fetch threw unexpectedly:", e);
    for (const code of allAreaCodes) for (const o of officeCodesForArea(code)) failedOfficeCodes.add(o);
  }
  if (failedOfficeCodes.size > 0) {
    summary.fetchFailed = true;
    const officeList = [...failedOfficeCodes].join(", ");
    console.warn(`[run-check] JMA fetch failed for offices: ${officeList} (該当地域の学校のみ UNKNOWN)`);
    if (deps.alert) {
      const msg =
        `⚠️ JMA警報取得に失敗（${checkTime} / ${targetDate}）\n` +
        `失敗した気象予報区(office)コード: ${officeList}\n` +
        `→ 該当地域の学校のみ UNKNOWN 判定になります（他地域は通常判定）。`;
      await deps.alert(msg).catch((e) => console.error("[run-check] alert failed:", e));
    }
  }

  // 3.5 その日の「より早い checkTime」で確定済みの判定を school ごとに取得
  //     （WARNING_CLEARED 条件の afterClosureOnly=「午前が休みだったか」判定に使う）。
  const priorResults = await warningChecksRepo.listPriorResultsBySchool(
    deps.db,
    schoolIds,
    targetDate,
    checkTime,
  );

  // 4. ルールごとに評価 → 保存 → 通知
  for (const ruleRow of rules) {
    summary.rulesProcessed++;
    const school = engineSchools.get(ruleRow.schoolId);
    if (!school) continue;

    const rule = rulesRepo.toSchoolRule(ruleRow);
    let result: CheckResult;
    let matched: boolean;
    let matchedWarnings: Warning[];

    // この学校が属する office のいずれかが取得失敗なら UNKNOWN（他地域は通常判定を継続）。
    const schoolFetchFailed = (school.areaCodes ?? []).some((code) =>
      officeCodesForArea(code).some((o) => failedOfficeCodes.has(o)),
    );
    if (schoolFetchFailed) {
      result = "UNKNOWN";
      matched = false;
      matchedWarnings = [];
    } else {
      const ev = evaluateSchoolRule({
        school,
        rule,
        activeWarnings: warnings,
        dayContext: { priorResult: priorResults.get(ruleRow.schoolId) },
      });
      result = ev.result;
      matched = ev.matched;
      matchedWarnings = ev.matchedWarnings;
    }

    // warning_checks 保存（最初の判定を確定・二重判定防止 §34, §35）
    const { row, created } = await warningChecksRepo.upsertWarningCheck(deps.db, {
      schoolId: ruleRow.schoolId,
      ruleId: ruleRow.id,
      targetDate,
      checkedAt: triggeredAt,
      warningActive: matched,
      result,
      rawData: matchedWarnings,
    });
    if (created) summary.checksCreated++;

    // 通知（NORMAL は通知しない §19）。保存済みの結果(row.result)を採用（確定性）
    const storedResult = row.result as CheckResult;

    // イベント連動フロー（休校などの判定）。新規確定時のみ・休み系のみ発火（同日重複しない）。
    if (created && isClosureResult(storedResult)) {
      deps.emitEvent?.({ eventType: "judgment.closure", schoolId: ruleRow.schoolId });
    }

    // 警報連動の休校ドラフト自動生成（プラン有効校のみ・同日1件 / M16）。
    // 先生がダッシュボードで確認→ワンタップで公式送信できる叩き台。
    if (isClosureResult(storedResult)) {
      const s = await schoolsRepo.findSchoolById(deps.db, ruleRow.schoolId);
      if (s && isPlanActive(s, now())) {
        await closureDraftsRepo.upsertPendingDraft(deps.db, {
          schoolId: ruleRow.schoolId,
          targetDate,
          result: storedResult,
          text: buildClosureDraftText(storedResult, matchedWarnings),
        });
      }
    }

    if (!shouldNotify(storedResult)) continue;

    const subscribers = await subscriptionsRepo.listEnabledSubscribersBySchool(deps.db, ruleRow.schoolId);
    const text = buildNotificationText({
      result: storedResult,
      schoolName: school.name,
      checkTime,
      matchedWarnings,
    });

    for (const sub of subscribers) {
      // 二重通知防止（§36）。既に通知行があればスキップ
      const { created: notifCreated, row: notifRow } = await notificationsRepo.createNotificationIfAbsent(deps.db, {
        userId: sub.userId,
        schoolId: ruleRow.schoolId,
        ruleId: ruleRow.id,
        targetDate,
        status: storedResult,
      });
      if (!notifCreated || !notifRow) continue;

      // 通知先の解決: デバイストークンがあれば FCM(無料)、無ければ LINE プッシュ(フォールバック)
      const deviceTokens = await deviceTokensRepo.listTokensByUser(deps.db, sub.userId);
      const push = deps.pushProvider;
      try {
        if (deviceTokens.length > 0 && push) {
          await push.send({ deviceTokens }, { text });
        } else {
          const lineUserId = await usersRepo.getLineUserId(deps.db, sub.userId);
          if (!lineUserId) continue;
          await deps.notificationProvider.send({ lineUserId }, { text });
        }
        await notificationsRepo.markNotificationSent(deps.db, notifRow.id, now());
        summary.notificationsSent++;
      } catch {
        summary.errors++;
      }
    }
  }

  return summary;
}
