import { CHECK_RESULT_LABEL, type CheckResult, type Warning } from "@yasumi/shared";

const DISCLAIMER = "※学校公式の発表ではありません。最終判断は学校公式情報をご確認ください。";

export interface NotificationTextInput {
  result: CheckResult;
  schoolName: string;
  checkTime: string; // "HH:MM"
  matchedWarnings: Warning[];
}

/**
 * 判定結果の LINE 通知文面を生成する純粋関数（PRD §18, §52）。
 */
export function buildNotificationText(input: NotificationTextInput): string {
  const { result, schoolName, checkTime, matchedWarnings } = input;
  const reason = formatReason(matchedWarnings);

  if (result === "UNKNOWN") {
    return [
      "⚠️ 判定できませんでした",
      "",
      schoolName,
      "",
      "気象情報を正常に取得できなかったため、本日の状態を判定できませんでした。",
      DISCLAIMER,
    ].join("\n");
  }

  if (result === "FULL_OFF") {
    return [
      "🎉 本日は休校です",
      "",
      schoolName,
      "",
      `${checkTime}現在、対象となる警報が継続しています。`,
      reason,
      "",
      `学校規則上、「${CHECK_RESULT_LABEL[result]}」に該当します。`,
      DISCLAIMER,
    ]
      .filter(Boolean)
      .join("\n");
  }

  // WAIT / AM_OFF / PM_START
  return [
    "🚨 やすみ？ 判定",
    "",
    schoolName,
    "",
    `${checkTime}現在、対象地域に警報が発表されています。`,
    reason,
    "",
    `学校規則上、「${CHECK_RESULT_LABEL[result]}」に該当します。`,
    DISCLAIMER,
  ]
    .filter(Boolean)
    .join("\n");
}

/** 判定根拠（地域/警報）を「三田市 暴風警報」形式で列挙。 */
function formatReason(warnings: Warning[]): string {
  if (warnings.length === 0) return "";
  const lines = warnings.map((w) => `${w.areaName} ${w.warningType}`);
  return [...new Set(lines)].join("\n");
}
