import type { CheckResult, SchoolRule, Warning } from "@yasumi/shared";

/** GET /api/me */
export interface Me {
  userId: string;
}

/** 学校サマリ（GET /api/schools/search, 詳細の共通部分） */
export interface SchoolSummary {
  id: string;
  name: string;
  prefecture: string;
  city: string | null;
  websiteUrl: string | null;
  rulesUrl: string | null;
}

/** GET /api/schools/:id */
export interface SchoolDetail extends SchoolSummary {
  areaCodes: string[];
  warningTypes: string[];
  rules: SchoolRule[];
}

/** GET /api/areas */
export interface Area {
  code: string;
  name: string;
  prefecture: string;
}

/** GET /api/me/subscriptions */
export interface Subscription {
  userId: string;
  schoolId: string;
  notificationEnabled: boolean;
}

/** GET /api/schools/:id/status（ホームの今日の状態） */
export interface SchoolStatus {
  schoolId: string;
  schoolName: string;
  date: string;
  latest: { result: CheckResult; checkedAt: string; warnings: Warning[] } | null;
  checks: { result: CheckResult; checkedAt: string; targetDate: string }[];
}

export type { CheckResult, Warning };
