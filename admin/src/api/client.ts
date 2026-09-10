import { type Auth, clearAuth, getAuth } from "../lib/auth.ts";

const BASE = import.meta.env.VITE_ADMIN_API_BASE_URL ?? "";

export class ApiError extends Error {
  constructor(public status: number, message?: string) {
    super(message ?? `API error ${status}`);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAuth()?.token;
  const res = await fetch(`${BASE}/api/admin${path}`, {
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

// --- types ---
export type Role = "superadmin" | "admin";
export interface Admin {
  id: string;
  username: string;
  role: Role;
  disabled: boolean;
  createdAt: string;
}
export interface Stats {
  date: string;
  schools: number;
  users: number;
  subscriptions: number;
  checksToday: number;
  notificationsToday: number;
}
export interface School {
  id: string;
  name: string;
  prefecture: string;
  city: string | null;
  websiteUrl: string | null;
  createdAt: string;
}
export interface SchoolDetail extends School {
  areaCodes: string[];
  warningTypes: string[];
  rules: { id: string; checkTime: string; result: string }[];
}
export interface Area {
  code: string;
  name: string;
  prefecture: string;
}
export interface UserRow {
  id: string;
  lineUserId: string | null;
  createdAt: string;
}
export interface UserSubscription {
  schoolId: string;
  schoolName: string;
  notificationEnabled: boolean;
  createdAt: string;
}
export interface UserDetail {
  id: string;
  lineUserId: string | null;
  deviceTokenCount: number;
  subscriptions: UserSubscription[];
  profile: { displayName: string; pictureUrl?: string; statusMessage?: string } | null;
}
export interface WarningCheck {
  id: string;
  schoolId: string;
  ruleId: string;
  targetDate: string;
  checkedAt: string;
  result: string;
  warningActive: boolean;
}
export interface NotificationRow {
  id: string;
  userId: string;
  schoolId: string;
  targetDate: string;
  status: string;
  sentAt: string | null;
}

export const api = {
  login: (username: string, password: string) =>
    request<Auth>("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  me: () => request<{ admin: Admin }>("/me"),
  stats: () => request<Stats>("/stats"),
  // admins
  listAdmins: () => request<Admin[]>("/admins"),
  createAdmin: (b: { username: string; password: string; role: Role }) =>
    request<Admin>("/admins", { method: "POST", body: JSON.stringify(b) }),
  updateAdmin: (id: string, b: { role?: Role; disabled?: boolean; password?: string }) =>
    request<Admin>(`/admins/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
  // schools
  listSchools: (q?: string) => request<School[]>(`/schools${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  getSchool: (id: string) => request<SchoolDetail>(`/schools/${id}`),
  createSchool: (b: { name: string; prefecture: string; city?: string; areaCodes?: string[]; warningTypes?: string[] }) =>
    request<School>("/schools", { method: "POST", body: JSON.stringify(b) }),
  updateSchool: (id: string, b: Record<string, unknown>) =>
    request<School>(`/schools/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
  deleteSchool: (id: string) => request<void>(`/schools/${id}`, { method: "DELETE" }),
  createRule: (schoolId: string, b: { checkTime: string; result: string }) =>
    request(`/schools/${schoolId}/rules`, { method: "POST", body: JSON.stringify(b) }),
  deleteRule: (id: string) => request<void>(`/rules/${id}`, { method: "DELETE" }),
  // areas
  listAreas: (prefecture?: string) => request<Area[]>(`/areas${prefecture ? `?prefecture=${encodeURIComponent(prefecture)}` : ""}`),
  createArea: (b: Area) => request<Area>("/areas", { method: "POST", body: JSON.stringify(b) }),
  deleteArea: (code: string) => request<void>(`/areas/${code}`, { method: "DELETE" }),
  // users
  listUsers: () => request<UserRow[]>("/users"),
  getUser: (id: string) => request<UserDetail>(`/users/${id}`),
  sendUserMessage: (id: string, text: string) =>
    request<{ ok: boolean }>(`/users/${id}/message`, { method: "POST", body: JSON.stringify({ text }) }),
  addUserSubscription: (id: string, schoolId: string) =>
    request(`/users/${id}/subscriptions`, { method: "POST", body: JSON.stringify({ schoolId }) }),
  setUserSubscription: (id: string, schoolId: string, notificationEnabled: boolean) =>
    request(`/users/${id}/subscriptions/${schoolId}`, { method: "PATCH", body: JSON.stringify({ notificationEnabled }) }),
  removeUserSubscription: (id: string, schoolId: string) =>
    request<void>(`/users/${id}/subscriptions/${schoolId}`, { method: "DELETE" }),
  // read
  listWarningChecks: (date?: string) => request<WarningCheck[]>(`/warning-checks${date ? `?date=${date}` : ""}`),
  listNotifications: (date?: string) => request<NotificationRow[]>(`/notifications${date ? `?date=${date}` : ""}`),
};
