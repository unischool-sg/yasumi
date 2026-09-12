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

const WEEKDAY = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tokyo", weekday: "short" });
const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** JST の曜日（0=日曜..6=土曜）。 */
export function jstWeekday(date: Date): number {
  return WEEKDAY_INDEX[WEEKDAY.format(date)] ?? 0;
}
