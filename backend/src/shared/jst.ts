// JST 基準の時刻ユーティリティ（PRD §34 判定確定性・cron の時刻整合）。

const HHMM = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Tokyo",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const YMD = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** JST の "HH:MM"。 */
export function jstHhmm(date: Date): string {
  return HHMM.format(date);
}

/** JST の "YYYY-MM-DD"（target_date に使う）。 */
export function jstDateString(date: Date): string {
  return YMD.format(date);
}
