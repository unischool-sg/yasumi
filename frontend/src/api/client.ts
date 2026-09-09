import type { CheckResult, SchoolRule } from "@yasumi/shared";
import type { Area, Me, SchoolDetail, SchoolStatus, SchoolSummary, Subscription } from "./types.ts";

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
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
