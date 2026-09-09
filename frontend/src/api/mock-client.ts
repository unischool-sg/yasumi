import type { CheckResult, SchoolRule } from "@yasumi/shared";
import type { ApiClient, NewSchoolInput, SchoolPatch } from "./client.ts";
import type { Area, SchoolDetail, SchoolStatus, SchoolSummary, Subscription } from "./types.ts";

// デザイン確認用のモッククライアント（VITE_MOCK=1 のとき useLiff が使用）。
// バックエンド/LIFF なしで実画面をサンプルデータで表示するための開発専用。

const schools: SchoolSummary[] = [
  { id: "s1", name: "三田学園高等学校", prefecture: "兵庫県", city: "三田市", websiteUrl: null, rulesUrl: null },
  { id: "s2", name: "神戸海星女子学院高等学校", prefecture: "兵庫県", city: "神戸市灘区", websiteUrl: null, rulesUrl: null },
  { id: "s3", name: "西宮市立西宮高等学校", prefecture: "兵庫県", city: "西宮市", websiteUrl: null, rulesUrl: null },
];

const rulesBySchool: Record<string, SchoolRule[]> = {
  s1: [
    { id: "r1", schoolId: "s1", checkTime: "08:00", condition: { type: "WARNING_ACTIVE" }, result: "AM_OFF" },
    { id: "r2", schoolId: "s1", checkTime: "10:00", condition: { type: "WARNING_ACTIVE" }, result: "FULL_OFF" },
  ],
};

const areas: Area[] = [
  { code: "2834100", name: "三田市", prefecture: "兵庫県" },
  { code: "2810100", name: "神戸市", prefecture: "兵庫県" },
  { code: "2820600", name: "西宮市", prefecture: "兵庫県" },
  { code: "2821900", name: "宝塚市", prefecture: "兵庫県" },
  { code: "2830100", name: "川西市", prefecture: "兵庫県" },
];

let subscriptions: Subscription[] = [{ userId: "me", schoolId: "s1", notificationEnabled: true }];

// モックでは自分が作成した学校として s1 を扱う（編集タブ表示確認用）。
const mySchoolIds = new Set<string>(["s1"]);

const delay = <T>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 150));

export function createMockClient(): ApiClient {
  return {
    me: () => delay({ userId: "me" }),
    listMySchools: () => delay(schools.filter((s) => mySchoolIds.has(s.id))),
    searchSchools: (q: string) => delay(schools.filter((s) => s.name.includes(q))),
    getSchool: (id: string) => {
      const s = schools.find((x) => x.id === id) ?? schools[0]!;
      const detail: SchoolDetail = {
        ...s,
        areaCodes: id === "s1" ? ["2834100", "2810100"] : [],
        warningTypes: id === "s1" ? ["暴風警報", "大雨警報"] : [],
        rules: rulesBySchool[id] ?? [],
      };
      return delay(detail);
    },
    getStatus: (id: string): Promise<SchoolStatus> => {
      const s = schools.find((x) => x.id === id) ?? schools[0]!;
      // デザイン確認用に学校ごとに違う状態を返す
      const now = new Date().toISOString();
      if (id === "s1") {
        return delay({
          schoolId: id,
          schoolName: s.name,
          date: "2026-09-09",
          latest: {
            result: "AM_OFF" as CheckResult,
            checkedAt: now,
            warnings: [
              { areaCode: "2834100", areaName: "三田市", warningType: "暴風警報", status: "active", issuedAt: new Date() },
            ],
          },
          checks: [{ result: "AM_OFF", checkedAt: now, targetDate: "2026-09-09" }],
        });
      }
      return delay({ schoolId: id, schoolName: s.name, date: "2026-09-09", latest: { result: "NORMAL" as CheckResult, checkedAt: now, warnings: [] }, checks: [] });
    },
    listAreas: (prefecture?: string) =>
      delay(prefecture ? areas.filter((a) => a.prefecture === prefecture) : areas),
    listSubscriptions: () => delay([...subscriptions]),
    subscribe: (schoolId: string) => {
      if (!subscriptions.some((s) => s.schoolId === schoolId)) {
        subscriptions.push({ userId: "me", schoolId, notificationEnabled: true });
      }
      return delay({ userId: "me", schoolId, notificationEnabled: true });
    },
    unsubscribe: (schoolId: string) => {
      subscriptions = subscriptions.filter((s) => s.schoolId !== schoolId);
      return delay(undefined as void);
    },
    createSchool: (input: NewSchoolInput) => {
      const s: SchoolSummary = {
        id: `s${schools.length + 1}`,
        name: input.name,
        prefecture: input.prefecture,
        city: input.city ?? null,
        websiteUrl: input.websiteUrl ?? null,
        rulesUrl: null,
      };
      schools.push(s);
      mySchoolIds.add(s.id);
      return delay(s);
    },
    updateSchool: (id, patch) => {
      const s = schools.find((x) => x.id === id);
      if (s) {
        if (patch.name !== undefined) s.name = patch.name;
        if (patch.city !== undefined) s.city = patch.city;
        if (patch.websiteUrl !== undefined) s.websiteUrl = patch.websiteUrl;
      }
      return delay((s ?? schools[0]!) as SchoolSummary);
    },
    createRule: (schoolId: string, input: { checkTime: string; result: CheckResult }) => {
      const rule: SchoolRule = { id: `r${Date.now()}`, schoolId, condition: { type: "WARNING_ACTIVE" }, ...input };
      (rulesBySchool[schoolId] ??= []).push(rule);
      return delay(rule);
    },
    deleteRule: (ruleId: string) => {
      for (const k of Object.keys(rulesBySchool)) {
        rulesBySchool[k] = rulesBySchool[k]!.filter((r) => r.id !== ruleId);
      }
      return delay(undefined as void);
    },
    registerDeviceToken: (_input: { token: string; platform: "ios" | "android" | "web" }) =>
      delay(undefined as void),
    deleteDeviceToken: (_token: string) => delay(undefined as void),
  };
}
