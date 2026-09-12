import type { CheckResult, SchoolRule } from "@yasumi/shared";
import type {
  AbsenceReport, AbsenceSchool, AbsenceType, Area, Me, SchoolDetail, SchoolStatus,
  SchoolSummary, StudentProfile, Subscription,
} from "./types.ts";

export interface NewSchoolInput {
  name: string;
  prefecture: string;
  city?: string;
  websiteUrl?: string;
  areaCodes?: string[];
  warningTypes?: string[];
}

/** PATCH /api/schools/:id の部分更新入力（編集タブ）。 */
export interface SchoolPatch {
  name?: string;
  city?: string | null;
  websiteUrl?: string | null;
  areaCodes?: string[];
  warningTypes?: string[];
}

const BASE = import.meta.env.VITE_API_BASE_URL ?? "";

export class ApiError extends Error {
  constructor(public status: number, message?: string) {
    super(message ?? `API error ${status}`);
  }
}

/** ID トークンを Authorization に付与する API クライアント（backend/API.md §3）。 */
export function createApiClient(idToken: string) {
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${idToken}`,
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...init?.headers,
      },
    });
    if (!res.ok) throw new ApiError(res.status);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  return {
    me: () => request<Me>("/api/me"),
    /** 自分が作成した学校の一覧（編集タブ）。 */
    listMySchools: () => request<SchoolSummary[]>("/api/me/schools"),
    searchSchools: (q: string) =>
      request<SchoolSummary[]>(`/api/schools/search?q=${encodeURIComponent(q)}`),
    getSchool: (id: string) => request<SchoolDetail>(`/api/schools/${id}`),
    getStatus: (id: string) => request<SchoolStatus>(`/api/schools/${id}/status`),
    listAreas: (prefecture?: string) =>
      request<Area[]>(`/api/areas${prefecture ? `?prefecture=${encodeURIComponent(prefecture)}` : ""}`),
    listSubscriptions: () => request<Subscription[]>("/api/me/subscriptions"),
    subscribe: (schoolId: string) =>
      request<Subscription>("/api/me/subscriptions", {
        method: "POST",
        body: JSON.stringify({ schoolId }),
      }),
    unsubscribe: (schoolId: string) =>
      request<void>(`/api/me/subscriptions/${schoolId}`, { method: "DELETE" }),
    createSchool: (input: NewSchoolInput) =>
      request<SchoolSummary>("/api/schools", { method: "POST", body: JSON.stringify(input) }),
    /** 学校を更新（作成者/管理者のみ）。 */
    updateSchool: (id: string, patch: SchoolPatch) =>
      request<SchoolSummary>(`/api/schools/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
    createRule: (schoolId: string, input: { checkTime: string; result: CheckResult }) =>
      request<SchoolRule>(`/api/schools/${schoolId}/rules`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    deleteRule: (ruleId: string) =>
      request<void>(`/api/rules/${ruleId}`, { method: "DELETE" }),
    /** 広告アトリビューション（gclid）を保存（Google Ads コンバージョン計測）。 */
    saveAttribution: (input: { gclid: string }) =>
      request<{ ok: boolean }>("/api/me/attribution", { method: "POST", body: JSON.stringify(input) }),
    /** 欠席受付が使える学校（premium・購読中）。 */
    listAbsenceSchools: () => request<AbsenceSchool[]>("/api/me/absence-schools"),
    /** 自分の生徒プロフィール一覧。 */
    listStudentProfiles: () => request<StudentProfile[]>("/api/me/student-profiles"),
    createStudentProfile: (input: { schoolId: string; studentName: string; grade?: string; className?: string }) =>
      request<StudentProfile>("/api/me/student-profiles", { method: "POST", body: JSON.stringify(input) }),
    /** 欠席・遅刻・早退・休校を連絡（premium校のみ）。 */
    createAbsenceReport: (input: {
      schoolId: string; studentProfileId: string; date: string; type: AbsenceType; reason?: string; note?: string;
    }) => request<AbsenceReport>("/api/me/absence-reports", { method: "POST", body: JSON.stringify(input) }),
    /** ネイティブ/PWA の FCM デバイストークンを登録（無料プッシュの送信先 / Part B）。 */
    registerDeviceToken: (input: { token: string; platform: "ios" | "android" | "web" }) =>
      request<void>("/api/me/device-tokens", { method: "POST", body: JSON.stringify(input) }),
    /** デバイストークンを削除（ログアウト時など）。 */
    deleteDeviceToken: (token: string) =>
      request<void>(`/api/me/device-tokens?token=${encodeURIComponent(token)}`, { method: "DELETE" }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
