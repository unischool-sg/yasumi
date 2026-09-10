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
