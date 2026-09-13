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

/**
 * プッシュ送信の失敗（HTTP ステータス付き）。
 * LINE Push はユーザーが公式アカウントを友だち追加していないと 400 を返す。
 * 呼び出し側はこれを「未友だち＝配信不能」として通常エラーと区別できる。
 */
export class PushDeliveryError extends Error {
  constructor(
    public readonly status: number,
    message?: string,
  ) {
    super(message ?? `push delivery failed (HTTP ${status})`);
    this.name = "PushDeliveryError";
  }
}

/** LINE Push の「未友だち」起因の失敗か（HTTP 400）。将来 403 等も足せる。 */
export function isUndeliverablePushError(e: unknown): boolean {
  return e instanceof PushDeliveryError && e.status === 400;
}

/** NORMAL は通知しない。それ以外（WAIT/AM_OFF/PM_START/FULL_OFF/UNKNOWN）は通知（PRD §19）。 */
export function shouldNotify(result: CheckResult): boolean {
  return result !== "NORMAL";
}
