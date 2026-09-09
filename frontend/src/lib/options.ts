import { CHECK_RESULT_LABEL, type CheckResult } from "@yasumi/shared";

/** 都道府県の選択肢（学校登録 Step1）。 */
export const PREFECTURES = [
  "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県",
  "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
  "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県",
  "静岡県", "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県",
  "奈良県", "和歌山県", "鳥取県", "島根県", "岡山県", "広島県", "山口県",
  "徳島県", "香川県", "愛媛県", "高知県", "福岡県", "佐賀県", "長崎県",
  "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
] as const;

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
