import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import type { Sql } from "postgres";
import * as schema from "../infrastructure/db/schema.ts";
import { createSchool } from "../infrastructure/db/repositories/schools.ts";
import { upsertAreas } from "../infrastructure/db/repositories/areas.ts";
import { createApp } from "./app.ts";

// docker postgres が要る結合テスト。TEST_DATABASE_URL 未設定なら丸ごとスキップ。
const TEST_DB = process.env.TEST_DATABASE_URL;
const suite = TEST_DB ? describe : describe.skip;

suite("API integration", () => {
  let sql: Sql;
  let app: ReturnType<typeof createApp>;
  let schoolId: string;

  const auth = (line: string) => ({ Authorization: `Bearer ${line}` });
  const req = (path: string, init?: RequestInit) => app.fetch(new Request(`http://x${path}`, init));

  beforeAll(async () => {
    sql = postgres(TEST_DB!, { max: 1 });
    const db = drizzle(sql, { schema });
    await migrate(db, { migrationsFolder: join(import.meta.dir, "../../drizzle") });
    // 検証: フェイク検証器はトークン文字列を lineUserId として扱う
    app = createApp({ db, verifyIdToken: async (token) => ({ lineUserId: token }) });

    await upsertAreas(db, [{ code: "2834100", name: "三田市", prefecture: "兵庫県" }]);
    const school = await createSchool(db, { name: "APIテスト学園", prefecture: "兵庫県", city: "三田市" });
    schoolId = school.id;
  });

  afterAll(async () => {
    await sql?.end();
  });

  it("認証なし → 401", async () => {
    const res = await req("/api/me");
    expect(res.status).toBe(401);
  });

  it("GET /api/me → 初回作成・冪等", async () => {
    const r1 = await req("/api/me", { headers: auth("Uapi1") });
    const r2 = await req("/api/me", { headers: auth("Uapi1") });
    expect(r1.status).toBe(200);
    const b1 = (await r1.json()) as { userId: string };
    const b2 = (await r2.json()) as { userId: string };
    expect(b1.userId).toBe(b2.userId);
  });

  it("GET /public/schools → 認証不要で公開情報のみ（PII なし）", async () => {
    const res = await req("/public/schools");
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Record<string, unknown>[];
    expect(rows.some((s) => s.id === schoolId)).toBe(true);
    // createdBy などの PII を含まない
    expect(rows.every((s) => !("createdBy" in s))).toBe(true);
  });

  it("GET /api/schools/search → 部分一致", async () => {
    const res = await req("/api/schools/search?q=APIテスト", { headers: auth("Uapi1") });
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { id: string }[];
    expect(rows.some((s) => s.id === schoolId)).toBe(true);
  });

  it("GET /api/schools/:id → 対象地域/警報/ルールを含む", async () => {
    const res = await req(`/api/schools/${schoolId}`, { headers: auth("Uapi1") });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { areaCodes: string[]; warningTypes: string[]; rules: unknown[] };
    expect(Array.isArray(body.areaCodes)).toBe(true);
    expect(Array.isArray(body.rules)).toBe(true);
  });

  it("GET /api/areas?prefecture= → 一覧", async () => {
    const res = await req("/api/areas?prefecture=兵庫県", { headers: auth("Uapi1") });
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { code: string }[];
    expect(rows.some((a) => a.code === "2834100")).toBe(true);
  });

  it("購読 作成→一覧→解除", async () => {
    const post = await req("/api/me/subscriptions", {
      method: "POST",
      headers: { ...auth("Uapi2"), "content-type": "application/json" },
      body: JSON.stringify({ schoolId }),
    });
    expect(post.status).toBe(201);

    const list = await req("/api/me/subscriptions", { headers: auth("Uapi2") });
    const rows = (await list.json()) as { schoolId: string }[];
    expect(rows.some((s) => s.schoolId === schoolId)).toBe(true);

    const del = await req(`/api/me/subscriptions/${schoolId}`, { method: "DELETE", headers: auth("Uapi2") });
    expect(del.status).toBe(204);

    const list2 = await req("/api/me/subscriptions", { headers: auth("Uapi2") });
    const rows2 = (await list2.json()) as { schoolId: string }[];
    expect(rows2.some((s) => s.schoolId === schoolId)).toBe(false);
  });

  it("デバイストークン 登録→upsert冪等→削除", async () => {
    const body = JSON.stringify({ token: "fcm-token-1", platform: "android" });
    const post = await req("/api/me/device-tokens", {
      method: "POST",
      headers: { ...auth("Udev"), "content-type": "application/json" },
      body,
    });
    expect(post.status).toBe(201);
    const row = (await post.json()) as { token: string; platform: string };
    expect(row.token).toBe("fcm-token-1");

    // 同一トークンの再登録は upsert（201・重複行なし）
    const post2 = await req("/api/me/device-tokens", {
      method: "POST",
      headers: { ...auth("Udev"), "content-type": "application/json" },
      body,
    });
    expect(post2.status).toBe(201);

    // 削除
    const del = await req("/api/me/device-tokens?token=fcm-token-1", { method: "DELETE", headers: auth("Udev") });
    expect(del.status).toBe(204);
  });

  it("存在しない学校の購読 → 404", async () => {
    const res = await req("/api/me/subscriptions", {
      method: "POST",
      headers: { ...auth("Uapi3"), "content-type": "application/json" },
      body: JSON.stringify({ schoolId: "00000000-0000-0000-0000-000000000000" }),
    });
    expect(res.status).toBe(404);
  });

  // --- M5: 学校登録 + ルール + 権限 ---
  it("POST /api/schools → 作成し created_by=自分。地域/警報も設定", async () => {
    const res = await req("/api/schools", {
      method: "POST",
      headers: { ...auth("Uowner"), "content-type": "application/json" },
      body: JSON.stringify({
        name: "登録テスト校",
        prefecture: "兵庫県",
        city: "三田市",
        areaCodes: ["2834100"],
        warningTypes: ["暴風警報"],
      }),
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string };
    const detail = await (await req(`/api/schools/${created.id}`, { headers: auth("Uowner") })).json();
    expect((detail as { areaCodes: string[] }).areaCodes).toContain("2834100");
    expect((detail as { warningTypes: string[] }).warningTypes).toContain("暴風警報");
  });

  it("GET /api/me/schools → 自分が作成した学校のみ返す", async () => {
    const created = (await (
      await req("/api/schools", {
        method: "POST",
        headers: { ...auth("Umine"), "content-type": "application/json" },
        body: JSON.stringify({ name: "自分の学校", prefecture: "兵庫県" }),
      })
    ).json()) as { id: string };

    const mine = await req("/api/me/schools", { headers: auth("Umine") });
    expect(mine.status).toBe(200);
    const rows = (await mine.json()) as { id: string }[];
    expect(rows.some((s) => s.id === created.id)).toBe(true);

    // 他人には見えない
    const others = await req("/api/me/schools", { headers: auth("Uother") });
    const otherRows = (await others.json()) as { id: string }[];
    expect(otherRows.some((s) => s.id === created.id)).toBe(false);
  });

  it("ルール: 30分刻みのみ許可・作成者は作成/削除でき、他人は403", async () => {
    const created = (await (
      await req("/api/schools", {
        method: "POST",
        headers: { ...auth("Uowner2"), "content-type": "application/json" },
        body: JSON.stringify({ name: "ルール校", prefecture: "兵庫県" }),
      })
    ).json()) as { id: string };

    // 08:15 は不正（30分刻みでない）→ 400
    const bad = await req(`/api/schools/${created.id}/rules`, {
      method: "POST",
      headers: { ...auth("Uowner2"), "content-type": "application/json" },
      body: JSON.stringify({ checkTime: "08:15", result: "AM_OFF" }),
    });
    expect(bad.status).toBe(400);

    // 08:00 AM_OFF → 201
    const ok = await req(`/api/schools/${created.id}/rules`, {
      method: "POST",
      headers: { ...auth("Uowner2"), "content-type": "application/json" },
      body: JSON.stringify({ checkTime: "08:00", result: "AM_OFF" }),
    });
    expect(ok.status).toBe(201);
    const rule = (await ok.json()) as { id: string; checkTime: string };
    expect(rule.checkTime).toBe("08:00");

    // 他人がルール作成 → 403
    const forbidden = await req(`/api/schools/${created.id}/rules`, {
      method: "POST",
      headers: { ...auth("Ustranger"), "content-type": "application/json" },
      body: JSON.stringify({ checkTime: "10:00", result: "FULL_OFF" }),
    });
    expect(forbidden.status).toBe(403);

    // 作成者が削除 → 204
    const del = await req(`/api/rules/${rule.id}`, { method: "DELETE", headers: auth("Uowner2") });
    expect(del.status).toBe(204);
  });
});
