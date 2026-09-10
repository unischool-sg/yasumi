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

/** 欠席受付が使える学校（premium・自分の購読校）。 */
export interface AbsenceSchool {
  id: string;
  name: string;
}

/** 生徒プロフィール（欠席連絡の主体）。 */
export interface StudentProfile {
  id: string;
  schoolId: string;
  studentName: string;
  grade: string | null;
  className: string | null;
}

export type AbsenceType = "欠席" | "遅刻" | "早退" | "休校";
export interface AbsenceReport {
  id: string;
  schoolId: string;
  studentProfileId: string;
  date: string;
  type: AbsenceType;
  reason: string | null;
  note: string | null;
  status: string;
  createdAt: string;
}

export type { CheckResult, Warning };
