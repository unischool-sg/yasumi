import type { FlowAudienceQuery, FlowStep } from "@yasumi/shared";
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
export type Plan = "basic" | "standard" | "premium";
export interface School {
  id: string;
  name: string;
  prefecture: string;
  city: string | null;
  websiteUrl: string | null;
  studentCount: number | null;
  plan: Plan | null;
  planExpiresAt: string | null;
  logoKey: string | null;
  createdAt: string;
}
export interface Teacher {
  id: string;
  schoolId: string;
  email: string;
  role: "owner" | "teacher";
  name: string;
  disabled: boolean;
  createdAt: string;
}
export interface SchoolStats {
  id: string;
  name: string;
  prefecture: string;
  city: string | null;
  studentCount: number | null;
  subscriberCount: number;
  enabledCount: number;
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
  subscriptionCount: number;
  flags: string[];
  subscribedSchools: { id: string; name: string }[];
}
export interface FlagDef {
  name: string;
  color: string | null;
  createdAt: string;
}
export interface AdminMessageTemplate {
  id: string;
  title: string;
  body: string;
  createdAt: string;
}
export interface FlowTemplate {
  id: string;
  name: string;
  allUsers: boolean;
  query: FlowAudienceQuery;
  steps: FlowStep[];
  createdAt: string;
  updatedAt: string;
}
export interface FlowTemplateInput {
  name: string;
  allUsers: boolean;
  query: FlowAudienceQuery;
  steps: FlowStep[];
}
export interface FlowSchedule {
  id: string;
  templateId: string;
  time: string; // "HH:MM"
  daysOfWeek: number[]; // 0=日..6=土、空配列は毎日
  enabled: boolean;
  lastRunAt: string | null;
  lastRunDate: string | null;
  createdAt: string;
}
export interface FlowRunResult {
  audienceCount: number;
  results: { type: FlowStep["type"]; flag?: string; sent?: number; total?: number }[];
}
export interface SchoolSubscriber {
  userId: string;
  lineUserId: string | null;
  notificationEnabled: boolean;
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
  flags: string[];
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
  getSchoolsOverview: () => request<SchoolStats[]>("/schools/overview"),
  getSchool: (id: string) => request<SchoolDetail>(`/schools/${id}`),
  getSchoolSubscribers: (id: string) => request<SchoolSubscriber[]>(`/schools/${id}/subscribers`),
  // teachers（教員アカウントのプロビジョニング）
  getSchoolTeachers: (id: string) => request<Teacher[]>(`/schools/${id}/teachers`),
  createTeacher: (id: string, b: { email: string; password: string; name: string; role?: "owner" | "teacher" }) =>
    request<Teacher>(`/schools/${id}/teachers`, { method: "POST", body: JSON.stringify(b) }),
  updateTeacher: (id: string, b: { role?: "owner" | "teacher"; disabled?: boolean; password?: string; name?: string }) =>
    request<Teacher>(`/teachers/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
  deleteTeacher: (id: string) => request<void>(`/teachers/${id}`, { method: "DELETE" }),
  // logo（RustFS）
  uploadSchoolLogo: (id: string, contentType: string, dataBase64: string) =>
    request<{ logoKey: string }>(`/schools/${id}/logo`, { method: "POST", body: JSON.stringify({ contentType, dataBase64 }) }),
  deleteSchoolLogo: (id: string) => request<void>(`/schools/${id}/logo`, { method: "DELETE" }),
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
  broadcast: (
    text: string,
    target: { type: "all" } | { type: "school"; schoolId: string } | { type: "users"; userIds: string[] },
  ) =>
    request<{ total: number; sent: number; failed: number }>("/broadcast", {
      method: "POST",
      body: JSON.stringify({ text, target }),
    }),
  // メッセージ定型文（ユーザー送信用）
  getMessageTemplates: () => request<AdminMessageTemplate[]>("/message-templates"),
  createMessageTemplate: (b: { title: string; body: string }) =>
    request<AdminMessageTemplate>("/message-templates", { method: "POST", body: JSON.stringify(b) }),
  updateMessageTemplate: (id: string, b: { title: string; body: string }) =>
    request<AdminMessageTemplate>(`/message-templates/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
  deleteMessageTemplate: (id: string) => request<void>(`/message-templates/${id}`, { method: "DELETE" }),
  // フラグ
  getFlagDefs: () => request<FlagDef[]>("/flag-defs"),
  createFlagDef: (b: { name: string; color?: string }) => request<FlagDef>("/flag-defs", { method: "POST", body: JSON.stringify(b) }),
  deleteFlagDef: (name: string) => request<void>(`/flag-defs/${encodeURIComponent(name)}`, { method: "DELETE" }),
  assignFlag: (userIds: string[], name: string) =>
    request<{ assigned: number; total: number }>("/flags/assign", { method: "POST", body: JSON.stringify({ userIds, name }) }),
  unassignFlag: (userIds: string[], name: string) =>
    request<{ ok: boolean; total: number }>("/flags/unassign", { method: "POST", body: JSON.stringify({ userIds, name }) }),
  // フロー（一括施策）テンプレート
  getFlowTemplates: () => request<FlowTemplate[]>("/flow-templates"),
  createFlowTemplate: (b: FlowTemplateInput) => request<FlowTemplate>("/flow-templates", { method: "POST", body: JSON.stringify(b) }),
  updateFlowTemplate: (id: string, b: FlowTemplateInput) => request<FlowTemplate>(`/flow-templates/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
  deleteFlowTemplate: (id: string) => request<void>(`/flow-templates/${id}`, { method: "DELETE" }),
  runFlowTemplate: (id: string) => request<FlowRunResult>(`/flow-templates/${id}/run`, { method: "POST" }),
  // フロー定期実行スケジュール
  getFlowSchedules: (templateId?: string) => request<FlowSchedule[]>(`/flow-schedules${templateId ? `?templateId=${templateId}` : ""}`),
  createFlowSchedule: (b: { templateId: string; time: string; daysOfWeek: number[]; enabled?: boolean }) =>
    request<FlowSchedule>("/flow-schedules", { method: "POST", body: JSON.stringify(b) }),
  updateFlowSchedule: (id: string, b: { time?: string; daysOfWeek?: number[]; enabled?: boolean }) =>
    request<FlowSchedule>(`/flow-schedules/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
  deleteFlowSchedule: (id: string) => request<void>(`/flow-schedules/${id}`, { method: "DELETE" }),
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
