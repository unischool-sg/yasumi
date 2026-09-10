import { type Auth, clearAuth, getAuth } from "../lib/auth.ts";

const BASE = import.meta.env.VITE_SCHOOL_API_BASE_URL ?? "";

export class ApiError extends Error {
  constructor(public status: number, message?: string) {
    super(message ?? `API error ${status}`);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAuth()?.token;
  const res = await fetch(`${BASE}/api/school${path}`, {
    ...init,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (res.status === 401) {
    clearAuth();
    if (!path.startsWith("/auth/login")) window.location.href = "/login";
    throw new ApiError(401);
  }
  if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => ({})))?.error);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export type Plan = "basic" | "standard" | "premium";
export interface Me {
  teacher: { id: string; schoolId: string; role: "owner" | "teacher"; email: string; name: string };
  school: { id: string; name: string; prefecture: string; plan: Plan | null; planExpiresAt: string | null } | null;
}
export interface Subscriber {
  userId: string;
  lineUserId: string | null;
  notificationEnabled: boolean;
  createdAt: string;
}
export type MessageCategory = "emergency" | "announcement";
export interface SchoolMessage {
  id: string;
  category: MessageCategory;
  text: string;
  total: number;
  sent: number;
  failed: number;
  createdAt: string;
}
export interface BroadcastResult {
  id: string;
  total: number;
  sent: number;
  failed: number;
}
export interface Quota {
  plan: Plan | null;
  announcement: { used: number; limit: number | null };
}
export type AbsenceStatus = "unread" | "confirmed";
export interface AbsenceReport {
  id: string;
  date: string;
  type: string;
  reason: string | null;
  note: string | null;
  warningActive: boolean;
  status: AbsenceStatus;
  createdAt: string;
  studentName: string;
  grade: string | null;
  className: string | null;
}

export const api = {
  login: (email: string, password: string) =>
    request<Auth>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  me: () => request<Me>("/me"),
  getSubscribers: () => request<Subscriber[]>("/subscribers"),
  getMessages: () => request<SchoolMessage[]>("/messages"),
  broadcast: (text: string, category: MessageCategory) =>
    request<BroadcastResult>("/broadcast", { method: "POST", body: JSON.stringify({ text, category }) }),
  getQuota: () => request<Quota>("/quota"),
  getAbsences: (status?: AbsenceStatus) =>
    request<AbsenceReport[]>(`/absences${status ? `?status=${status}` : ""}`),
  setAbsenceStatus: (id: string, status: AbsenceStatus) =>
    request<AbsenceReport>(`/absences/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
};
