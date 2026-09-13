import { type CheckResult, type Warning, isClosureResult } from "@yasumi/shared";

// 休校系判定は単一情報源（@yasumi/shared）を再エクスポート（既存 import 互換のため）。
export { isClosureResult };

const RESULT_LABEL: Record<string, string> = {
  WAIT: "自宅待機",
  AM_OFF: "午前休",
  PM_START: "午後から登校",
  FULL_OFF: "全日休校",
};

/** 警報連動の休校連絡ドラフト本文を生成（先生が編集・送信する叩き台）。 */
export function buildClosureDraftText(result: CheckResult, warnings: Warning[] = []): string {
  const label = RESULT_LABEL[result] ?? "登校について注意";
  const uniqueWarnings = [...new Set(warnings.map((w) => w.warningType))];
  const warnText = uniqueWarnings.length > 0 ? `対象地域に${uniqueWarnings.join("・")}が発表されています。` : "気象警報が発表されています。";
  const guide =
    result === "FULL_OFF"
      ? "本日は登校の必要はありません。ご家庭で安全にお過ごしください。"
      : result === "AM_OFF"
        ? "午前は自宅で待機してください。以降の対応は追ってご連絡します。"
        : result === "PM_START"
          ? "午後からの登校となります。時間にご注意ください。"
          : "自宅で待機し、今後の連絡をお待ちください。";
  
  return `【重要】本日の登校について\n\n${warnText}\n学校規則にもとづき、本日は「${label}」とします。\n${guide}\n\n最新情報は改めてお知らせします。`;
}
