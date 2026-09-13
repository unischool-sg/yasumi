import { CHECK_RESULT_LABEL, type CheckResult, type Warning } from "@yasumi/shared";

const DISCLAIMER = "※学校公式の発表ではありません。最終判断は学校公式情報をご確認ください。";

export interface NotificationTextInput {
  result: CheckResult;
  schoolName: string;
  checkTime: string; // "HH:MM"
  matchedWarnings: Warning[];
  /**
   * この学校の判定を友達に共有するためのミニアプリ招待URL（校内密度グロースの撒き餌）。
   * 未指定なら招待行を付けない（env-gated: MINIAPP_URL 未設定時はドーマント）。
   */
  inviteUrl?: string;
}

/**
 * 判定結果の LINE 通知文面を生成する純粋関数（PRD §18, §52）。
 */
export function buildNotificationText(input: NotificationTextInput): string {
  const { result, schoolName, checkTime, matchedWarnings, inviteUrl } = input;
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

  // 友達への共有を促す招待行（免責の前・警報連動の判定通知にのみ付与）。校内密度の撒き餌。
  const invite = inviteUrl ? ["", "▼この学校の判定を友達にも教える", inviteUrl] : [];

  // 警報解除にもとづく判定（WARNING_CLEARED 条件 / matchedWarnings が空）。
  // 例: 午前休のあと 10:00 に解除 → 午後から登校。「警報発表中」と書くと不適切なので分岐する。
  const clearedBased = matchedWarnings.length === 0;
  if (clearedBased) {
    return [
      "🚨 やすみ？ 判定",
      "",
      schoolName,
      "",
      `${checkTime}現在、対象となる気象警報は解除されています。`,
      "",
      `学校規則上、「${CHECK_RESULT_LABEL[result]}」に該当します。`,
      ...invite,
      DISCLAIMER,
    ]
      .filter(Boolean)
      .join("\n");
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
      ...invite,
      DISCLAIMER,
    ]
      .filter(Boolean)
      .join("\n");
  }

  // WAIT / AM_OFF / PM_START（警報発表中）
  return [
    "🚨 やすみ？ 判定",
    "",
    schoolName,
    "",
    `${checkTime}現在、対象地域に警報が発表されています。`,
    reason,
    "",
    `学校規則上、「${CHECK_RESULT_LABEL[result]}」に該当します。`,
    ...invite,
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
