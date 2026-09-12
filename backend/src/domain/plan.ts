/** 学校の有料プラン判定（M11〜）。plan は 'basic'|'standard'|'premium'|null。 */

export interface PlanFields {
  plan: string | null;
  planExpiresAt: Date | null;
}

/** 契約が有効か（plan があり、期限が無いか未来）。 */
export function isPlanActive(school: PlanFields, now: Date = new Date()): boolean {
  if (!school.plan) return false;
  if (school.planExpiresAt && school.planExpiresAt.getTime() <= now.getTime()) return false;
  return true;
}

/** 欠席受付（双方向）が使えるか＝有効な premium プラン。 */
export function absenceEnabled(school: PlanFields, now: Date = new Date()): boolean {
  return isPlanActive(school, now) && school.plan === "premium";
}

/**
 * 任意送信（お知らせ）の月間上限。null=無制限。警報連動・緊急は対象外（常に無制限）。
 * 有効なプランが無ければ 0。
 */
export function announcementMonthlyLimit(school: PlanFields, now: Date = new Date()): number | null {
  if (!isPlanActive(school, now)) return 0;
  switch (school.plan) {
    case "basic":
      return 10;
    case "standard":
      return 50;
    case "premium":
      return null; // 無制限
    default:
      return 0;
  }
}

/** 教員アカウントのプラン別上限（席数）。null=無制限。有効プラン無しは 0。 */
export function teacherSeatLimit(school: PlanFields, now: Date = new Date()): number | null {
  if (!isPlanActive(school, now)) return 0;
  switch (school.plan) {
    case "basic":
      return 1;
    case "standard":
      return 5;
    case "premium":
      return null; // 無制限
    default:
      return 0;
  }
}

/** 上位プラン機能。standard 以上 / premium 限定 を判定（すべて有効プラン前提）。 */
export type PlanFeature = "logo" | "segment" | "messageKind" | "ownerManageTeachers" | "csvExport";

const RANK: Record<string, number> = { basic: 1, standard: 2, premium: 3 };

export function planRank(plan: string | null): number {
  return plan ? (RANK[plan] ?? 0) : 0;
}

export function hasFeature(school: PlanFields, feature: PlanFeature, now: Date = new Date()): boolean {
  if (!isPlanActive(school, now)) return false;
  const rank = planRank(school.plan);
  switch (feature) {
    case "csvExport":
      return rank >= 3; // premium
    case "logo":
    case "segment":
    case "messageKind":
    case "ownerManageTeachers":
      return rank >= 2; // standard 以上
    default:
      return false;
  }
}

/** JST 当月1日 00:00 に相当する UTC 時刻（月間集計の起点）。 */
export function jstMonthStart(now: Date = new Date()): Date {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = jst.getUTCMonth();
  // JST 当月1日 00:00 = UTC で 9時間前
  return new Date(Date.UTC(y, m, 1, -9, 0, 0));
}
