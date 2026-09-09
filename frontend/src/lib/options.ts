import { CHECK_RESULT_LABEL, type CheckResult } from "@yasumi/shared";

/** 学校登録で選べる対象警報（PRD §13 Step3）。 */
export const WARNING_TYPE_OPTIONS = ["暴風警報", "大雨警報", "洪水警報", "大雪警報"] as const;

/** 判定結果の選択肢（UNKNOWN はシステム用のため登録では出さない / PRD §14）。 */
export const RESULT_OPTIONS: { value: CheckResult; label: string }[] = (
  ["NORMAL", "WAIT", "AM_OFF", "PM_START", "FULL_OFF"] as CheckResult[]
).map((value) => ({ value, label: CHECK_RESULT_LABEL[value] }));

/** 判定時刻の選択肢（30分刻み HH:00 / HH:30 / PRD §13 Step4）。 */
export const CHECK_TIME_OPTIONS: string[] = Array.from({ length: 48 }, (_, i) => {
  const h = String(Math.floor(i / 2)).padStart(2, "0");
  const m = i % 2 === 0 ? "00" : "30";
  return `${h}:${m}`;
});
