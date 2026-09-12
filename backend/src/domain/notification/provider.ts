import type { CheckResult } from "@yasumi/shared";

/**
 * 通知先。チャネルごとに使うフィールドが異なる（LINE=lineUserId / FCM=deviceTokens）。
 * 各 NotificationProvider は自分が使うフィールドのみ参照する。
 */
export interface NotificationTarget {
  lineUserId?: string;
  deviceTokens?: string[];
}

/** 通知メッセージ。action があれば LINE はボタン付き Flex で送る（FCM は本文にURLを付与）。 */
export interface NotificationMessage {
  text: string;
  /** タップで URL を開くボタン（例: 「確認する」）。 */
  action?: { label: string; url: string };
}

/** 通知処理の抽象（PRD §50, §62）。LINE 依存にしない。 */
export interface NotificationProvider {
  send(target: NotificationTarget, message: NotificationMessage): Promise<void>;
}

/** NORMAL は通知しない。それ以外（WAIT/AM_OFF/PM_START/FULL_OFF/UNKNOWN）は通知（PRD §19）。 */
export function shouldNotify(result: CheckResult): boolean {
  return result !== "NORMAL";
}
