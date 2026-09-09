import { CHECK_RESULT_LABEL, type CheckResult } from "@yasumi/shared";

export interface StatusStyle {
  label: string;
  /** マテリアルカラー（文字/ドット） */
  color: string;
}

// 判定結果ごとの色（Google マテリアルの配色）。
export const STATUS_STYLE: Record<CheckResult, StatusStyle> = {
  NORMAL: { label: CHECK_RESULT_LABEL.NORMAL, color: "#1e8e3e" },
  WAIT: { label: CHECK_RESULT_LABEL.WAIT, color: "#f9ab00" },
  AM_OFF: { label: CHECK_RESULT_LABEL.AM_OFF, color: "#e8710a" },
  PM_START: { label: CHECK_RESULT_LABEL.PM_START, color: "#e8710a" },
  FULL_OFF: { label: CHECK_RESULT_LABEL.FULL_OFF, color: "#d93025" },
  UNKNOWN: { label: CHECK_RESULT_LABEL.UNKNOWN, color: "#5f6368" },
};

export function timeLabel(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tokyo" }).format(d);
}
