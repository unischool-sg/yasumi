import type { Db } from "../../infrastructure/db/client.ts";
import * as deviceTokensRepo from "../../infrastructure/db/repositories/device-tokens.ts";
import * as notificationsRepo from "../../infrastructure/db/repositories/notifications.ts";
import * as usersRepo from "../../infrastructure/db/repositories/users.ts";
import { isUndeliverablePushError, type NotificationProvider } from "./provider.ts";

export interface DeliverDeps {
  db: Db;
  /** LINE プッシュ（デバイストークン未登録ユーザー向けフォールバック）。 */
  notificationProvider: NotificationProvider;
  /** FCM プッシュ（デバイストークン登録済みユーザー向け・無料・優先）。未設定なら LINE のみ。 */
  pushProvider?: NotificationProvider;
  now: () => Date;
}

export interface DeliverSpec {
  userId: string;
  schoolId: string;
  ruleId: string;
  targetDate: string; // "YYYY-MM-DD"
  status: string; // CheckResult
  text: string;
}

/** 送信結果（呼び出し側がサマリに集計する）。 */
export type DeliverOutcome = "sent" | "duplicate" | "undeliverable" | "error";

/**
 * 1購読者へ判定通知を送り、結果を notifications に記録する（送信本文・経路・エラーログ）。
 * cron の判定パイプラインと管理画面のテスト送信で共有する単一の送信経路（PRD §36）。
 * - duplicate: 既に同一(user,school,rule,target_date)の通知行があり送信しない
 * - undeliverable: 未友だち/配信先なし（運用エラーとは区別）
 * - error: その他の送信例外
 */
export async function deliverNotification(deps: DeliverDeps, spec: DeliverSpec): Promise<DeliverOutcome> {
  // 二重通知防止（§36）。既に通知行があればスキップ
  const { created, row } = await notificationsRepo.createNotificationIfAbsent(deps.db, {
    userId: spec.userId,
    schoolId: spec.schoolId,
    ruleId: spec.ruleId,
    targetDate: spec.targetDate,
    status: spec.status,
    messageText: spec.text,
  });
  if (!created || !row) return "duplicate";

  // 通知先の解決: デバイストークンがあれば FCM(無料)、無ければ LINE プッシュ(フォールバック)
  const deviceTokens = await deviceTokensRepo.listTokensByUser(deps.db, spec.userId);
  const push = deps.pushProvider;
  const channel = deviceTokens.length > 0 && push ? "fcm" : "line";
  try {
    if (channel === "fcm" && push) {
      await push.send({ deviceTokens }, { text: spec.text });
    } else {
      const lineUserId = await usersRepo.getLineUserId(deps.db, spec.userId);
      if (!lineUserId) {
        // LINE 連携が無く FCM も無い → 配信手段なし。原因が追えるよう記録。
        await notificationsRepo.markNotificationFailed(deps.db, row.id, {
          channel,
          error: "配信先なし: LINEユーザーID未登録（LINE未連携）かつデバイストークン無し",
        });
        return "undeliverable";
      }
      await deps.notificationProvider.send({ lineUserId }, { text: spec.text });
    }
    await notificationsRepo.markNotificationSent(deps.db, row.id, deps.now(), channel);
    return "sent";
  } catch (e) {
    // 失敗の原因（APIレスポンス等）を履歴に残す（管理画面の詳細モーダルで確認）。
    const error = e instanceof Error ? (e.stack ?? e.message) : String(e);
    await notificationsRepo.markNotificationFailed(deps.db, row.id, { channel, error });
    // 未友だち等で LINE 配信不能な場合は通常エラーと区別（運用アラートを鳴らさない）。
    return isUndeliverablePushError(e) ? "undeliverable" : "error";
  }
}
