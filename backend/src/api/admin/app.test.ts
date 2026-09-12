import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import type { Sql } from "postgres";
import { createApp } from "../app.ts";
import { createAdmin } from "../../infrastructure/db/repositories/admins.ts";
import * as schema from "../../infrastructure/db/schema.ts";

const TEST_DB = process.env.TEST_DATABASE_URL;
const suite = TEST_DB ? describe : describe.skip;

suite("Admin API", () => {
  let sql: Sql;
  let app: ReturnType<typeof createApp>;
  const SECRET = "test-admin-secret";
  const req = (path: string, init?: RequestInit) => app.fetch(new Request(`http://x${path}`, init));
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const suName = `su_${Math.random().toString(36).slice(2, 8)}`;
  const adName = `ad_${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(async () => {
    sql = postgres(TEST_DB!, { max: 1 });
    const db = drizzle(sql, { schema });
    await migrate(db, { migrationsFolder: join(import.meta.dir, "../../../drizzle") });
    // 事前に superadmin と admin を作成
    await createAdmin(db, { username: suName, passwordHash: await Bun.password.hash("password123"), role: "superadmin" });
    await createAdmin(db, { username: adName, passwordHash: await Bun.password.hash("password123"), role: "admin" });
    app = createApp({ db, verifyIdToken: async (t) => ({ lineUserId: t }), adminJwtSecret: SECRET });
  });
  afterAll(async () => {
    await sql?.end();
  });

  async function loginToken(username: string): Promise<string> {
    const res = await req("/api/admin/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password: "password123" }),
    });
    expect(res.status).toBe(200);
    return ((await res.json()) as { token: string }).token;
  }

  it("誤ったパスワード → 401", async () => {
    const res = await req("/api/admin/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: suName, password: "wrong" }),
    });
    expect(res.status).toBe(401);
  });

  it("認証なしの保護EP → 401", async () => {
    expect((await req("/api/admin/me")).status).toBe(401);
  });

  it("ログイン→/me", async () => {
    const t = await loginToken(suName);
    const me = await req("/api/admin/me", { headers: bearer(t) });
    expect(me.status).toBe(200);
    expect(((await me.json()) as { admin: { role: string } }).admin.role).toBe("superadmin");
  });

  it("admin は /admins にアクセス不可(403)、superadmin は可", async () => {
    const adT = await loginToken(adName);
    expect((await req("/api/admin/admins", { headers: bearer(adT) })).status).toBe(403);
    const suT = await loginToken(suName);
    const list = await req("/api/admin/admins", { headers: bearer(suT) });
    expect(list.status).toBe(200);
    expect(Array.isArray(await list.json())).toBe(true);
  });

  it("superadmin が管理者を作成", async () => {
    const suT = await loginToken(suName);
    const res = await req("/api/admin/admins", {
      method: "POST",
      headers: { ...bearer(suT), "content-type": "application/json" },
      body: JSON.stringify({ username: `new_${Math.random().toString(36).slice(2, 7)}`, password: "password123", role: "admin" }),
    });
    expect(res.status).toBe(201);
  });

  it("stats / schools作成 / areas作成", async () => {
    const t = await loginToken(adName);
    expect((await req("/api/admin/stats", { headers: bearer(t) })).status).toBe(200);

    const sc = await req("/api/admin/schools", {
      method: "POST",
      headers: { ...bearer(t), "content-type": "application/json" },
      body: JSON.stringify({ name: "管理作成校", prefecture: "兵庫県", areaCodes: ["2834100"], warningTypes: ["暴風警報"] }),
    });
    expect(sc.status).toBe(201);
    const school = (await sc.json()) as { id: string };
    const detail = await (await req(`/api/admin/schools/${school.id}`, { headers: bearer(t) })).json();
    expect((detail as { areaCodes: string[] }).areaCodes).toContain("2834100");

    const ar = await req("/api/admin/areas", {
      method: "POST",
      headers: { ...bearer(t), "content-type": "application/json" },
      body: JSON.stringify({ code: "2899999", name: "テスト町", prefecture: "兵庫県" }),
    });
    expect(ar.status).toBe(201);
  });

  it("ユーザー詳細・購読の追加/通知トグル/削除", async () => {
    const suT = await loginToken(suName);
    const { userId } = (await (await req("/api/me", { headers: bearer("Uadminmgmt") })).json()) as { userId: string };
    const school = (await (
      await req("/api/admin/schools", {
        method: "POST",
        headers: { ...bearer(suT), "content-type": "application/json" },
        body: JSON.stringify({ name: "購読編集校", prefecture: "兵庫県" }),
      })
    ).json()) as { id: string };

    // 購読追加
    const add = await req(`/api/admin/users/${userId}/subscriptions`, {
      method: "POST",
      headers: { ...bearer(suT), "content-type": "application/json" },
      body: JSON.stringify({ schoolId: school.id }),
    });
    expect(add.status).toBe(201);

    // 詳細（購読が学校名付き・lineUserId・デバイス0）
    const detail = (await (await req(`/api/admin/users/${userId}`, { headers: bearer(suT) })).json()) as {
      lineUserId: string;
      deviceTokenCount: number;
      subscriptions: { schoolId: string; schoolName: string; notificationEnabled: boolean }[];
    };
    expect(detail.lineUserId).toBe("Uadminmgmt");
    expect(detail.deviceTokenCount).toBe(0);
    expect(detail.subscriptions.some((s) => s.schoolId === school.id && s.schoolName === "購読編集校" && s.notificationEnabled)).toBe(true);

    // 学校の購読者一覧に出る
    const subs = (await (
      await req(`/api/admin/schools/${school.id}/subscribers`, { headers: bearer(suT) })
    ).json()) as { userId: string; lineUserId: string; notificationEnabled: boolean }[];
    expect(subs.some((s) => s.userId === userId && s.lineUserId === "Uadminmgmt")).toBe(true);

    // 通知OFF
    const patch = await req(`/api/admin/users/${userId}/subscriptions/${school.id}`, {
      method: "PATCH",
      headers: { ...bearer(suT), "content-type": "application/json" },
      body: JSON.stringify({ notificationEnabled: false }),
    });
    expect(patch.status).toBe(200);
    expect(((await patch.json()) as { notificationEnabled: boolean }).notificationEnabled).toBe(false);

    // 削除
    const del = await req(`/api/admin/users/${userId}/subscriptions/${school.id}`, { method: "DELETE", headers: bearer(suT) });
    expect(del.status).toBe(204);
  });

  it("学校の購読者数・生徒数・浸透率の集計（overview）", async () => {
    const suT = await loginToken(suName);
    // 生徒数(分母)付きで学校作成
    const school = (await (
      await req("/api/admin/schools", {
        method: "POST",
        headers: { ...bearer(suT), "content-type": "application/json" },
        body: JSON.stringify({ name: "浸透率テスト校", prefecture: "兵庫県", studentCount: 200 }),
      })
    ).json()) as { id: string; studentCount: number | null };
    expect(school.studentCount).toBe(200);

    // ユーザーを購読させる
    const { userId } = (await (await req("/api/me", { headers: bearer("Uoverview") })).json()) as { userId: string };
    await req(`/api/admin/users/${userId}/subscriptions`, {
      method: "POST",
      headers: { ...bearer(suT), "content-type": "application/json" },
      body: JSON.stringify({ schoolId: school.id }),
    });

    const overview = (await (await req("/api/admin/schools/overview", { headers: bearer(suT) })).json()) as {
      id: string;
      subscriberCount: number;
      enabledCount: number;
      studentCount: number | null;
    }[];
    const row = overview.find((s) => s.id === school.id);
    expect(row).toBeDefined();
    expect(row!.subscriberCount).toBe(1);
    expect(row!.enabledCount).toBe(1);
    expect(row!.studentCount).toBe(200);
  });

  it("ユーザーへメッセージ送信（プロバイダ経由）", async () => {
    const sent: { lineUserId?: string; text: string }[] = [];
    const msgApp = createApp({
      db: drizzle(sql, { schema }),
      verifyIdToken: async (t) => ({ lineUserId: t }),
      adminJwtSecret: SECRET,
      notificationProvider: {
        send: async (target, m) => {
          sent.push({ lineUserId: target.lineUserId, text: m.text });
        },
      },
    });
    const mreq = (path: string, init?: RequestInit) => msgApp.fetch(new Request(`http://x${path}`, init));
    const lr = await mreq("/api/admin/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: suName, password: "password123" }),
    });
    const t = ((await lr.json()) as { token: string }).token;
    const { userId } = (await (await mreq("/api/me", { headers: bearer("Umsg") })).json()) as { userId: string };

    const res = await mreq(`/api/admin/users/${userId}/message`, {
      method: "POST",
      headers: { ...bearer(t), "content-type": "application/json" },
      body: JSON.stringify({ text: "テスト連絡です" }),
    });
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.lineUserId).toBe("Umsg");
    expect(sent[0]?.text).toBe("テスト連絡です");
  });

  it("一斉送信: 学校購読者 / 全ユーザー", async () => {
    const sent: string[] = [];
    const bApp = createApp({
      db: drizzle(sql, { schema }),
      verifyIdToken: async (t) => ({ lineUserId: t }),
      adminJwtSecret: SECRET,
      notificationProvider: { send: async (target) => { sent.push(target.lineUserId ?? ""); } },
    });
    const breq = (path: string, init?: RequestInit) => bApp.fetch(new Request(`http://x${path}`, init));
    const lr = await breq("/api/admin/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: suName, password: "password123" }),
    });
    const t = ((await lr.json()) as { token: string }).token;
    const u1 = ((await (await breq("/api/me", { headers: bearer("Ubc1") })).json()) as { userId: string }).userId;
    const u2 = ((await (await breq("/api/me", { headers: bearer("Ubc2") })).json()) as { userId: string }).userId;
    const school = (await (
      await breq("/api/admin/schools", {
        method: "POST",
        headers: { ...bearer(t), "content-type": "application/json" },
        body: JSON.stringify({ name: "一斉校", prefecture: "兵庫県" }),
      })
    ).json()) as { id: string };
    for (const u of [u1, u2]) {
      await breq(`/api/admin/users/${u}/subscriptions`, {
        method: "POST",
        headers: { ...bearer(t), "content-type": "application/json" },
        body: JSON.stringify({ schoolId: school.id }),
      });
    }

    // 学校の購読者へ
    sent.length = 0;
    const r1 = await breq("/api/admin/broadcast", {
      method: "POST",
      headers: { ...bearer(t), "content-type": "application/json" },
      body: JSON.stringify({ text: "学校連絡", target: { type: "school", schoolId: school.id } }),
    });
    expect(r1.status).toBe(200);
    expect(((await r1.json()) as { sent: number }).sent).toBe(2);
    expect(sent).toContain("Ubc1");
    expect(sent).toContain("Ubc2");

    // 全ユーザーへ（少なくとも上記2名）
    sent.length = 0;
    const r2 = await breq("/api/admin/broadcast", {
      method: "POST",
      headers: { ...bearer(t), "content-type": "application/json" },
      body: JSON.stringify({ text: "全体連絡", target: { type: "all" } }),
    });
    expect(((await r2.json()) as { sent: number }).sent).toBeGreaterThanOrEqual(2);
  });

  it("ユーザー一覧に購読数・複数選択送信・定型文CRUD", async () => {
    const suT = await loginToken(suName);
    // 学校作成＋ユーザー購読
    const school = (await (await req("/api/admin/schools", {
      method: "POST", headers: { ...bearer(suT), "content-type": "application/json" },
      body: JSON.stringify({ name: "購読数テスト校", prefecture: "兵庫県" }),
    })).json()) as { id: string };
    const { userId } = (await (await req("/api/me", { headers: bearer("Usubcount") })).json()) as { userId: string };
    await req(`/api/admin/users/${userId}/subscriptions`, {
      method: "POST", headers: { ...bearer(suT), "content-type": "application/json" },
      body: JSON.stringify({ schoolId: school.id }),
    });

    // 一覧に subscriptionCount
    const users = (await (await req("/api/admin/users", { headers: bearer(suT) })).json()) as { id: string; subscriptionCount: number }[];
    expect(users.find((u) => u.id === userId)?.subscriptionCount).toBe(1);

    // 複数選択（users型）送信
    const bc = await req("/api/admin/broadcast", {
      method: "POST", headers: { ...bearer(suT), "content-type": "application/json" },
      body: JSON.stringify({ text: "選択送信", target: { type: "users", userIds: [userId] } }),
    });
    expect(bc.status).toBe(200);
    expect(((await bc.json()) as { total: number }).total).toBe(1);

    // 定型文 CRUD
    const created = await req("/api/admin/message-templates", {
      method: "POST", headers: { ...bearer(suT), "content-type": "application/json" },
      body: JSON.stringify({ title: "お礼", body: "ご登録ありがとうございます" }),
    });
    expect(created.status).toBe(201);
    const tpl = (await created.json()) as { id: string };
    const list = (await (await req("/api/admin/message-templates", { headers: bearer(suT) })).json()) as { id: string; title: string }[];
    expect(list.some((x) => x.id === tpl.id && x.title === "お礼")).toBe(true);
    expect((await req(`/api/admin/message-templates/${tpl.id}`, { method: "DELETE", headers: bearer(suT) })).status).toBe(204);
  });
});
