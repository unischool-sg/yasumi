import type { CheckResult, SchoolRule } from "@yasumi/shared";
import type { Area, Me, SchoolDetail, SchoolSummary, Subscription } from "./types.ts";

export interface NewSchoolInput {
  name: string;
  prefecture: string;
  city?: string;
  websiteUrl?: string;
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
    searchSchools: (q: string) =>
      request<SchoolSummary[]>(`/api/schools/search?q=${encodeURIComponent(q)}`),
    getSchool: (id: string) => request<SchoolDetail>(`/api/schools/${id}`),
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
    createRule: (schoolId: string, input: { checkTime: string; result: CheckResult }) =>
      request<SchoolRule>(`/api/schools/${schoolId}/rules`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
