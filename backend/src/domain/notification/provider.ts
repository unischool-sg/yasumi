import type { CheckResult } from "@yasumi/shared";

/** 通知先（LINE は lineUserId）。将来の通知手段では別フィールドを足す。 */
export interface NotificationTarget {
  lineUserId: string;
}

/** 通知メッセージ（MVP は text のみ / 将来 Flex 等）。 */
export interface NotificationMessage {
  text: string;
}

/** 通知処理の抽象（PRD §50, §62）。LINE 依存にしない。 */
export interface NotificationProvider {
  send(target: NotificationTarget, message: NotificationMessage): Promise<void>;
}

/** NORMAL は通知しない。それ以外（WAIT/AM_OFF/PM_START/FULL_OFF/UNKNOWN）は通知（PRD §19）。 */
export function shouldNotify(result: CheckResult): boolean {
  return result !== "NORMAL";
}
