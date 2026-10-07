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

  it("テスト送信: 購読者全員へ実経路で送信し、履歴に本文・経路が記録される", async () => {
    const sent: { lineUserId?: string; text: string }[] = [];
    const tApp = createApp({
      db: drizzle(sql, { schema }),
      verifyIdToken: async (t) => ({ lineUserId: t }),
      adminJwtSecret: SECRET,
      notificationProvider: { send: async (target, m) => { sent.push({ lineUserId: target.lineUserId, text: m.text }); } },
    });
    const treq = (path: string, init?: RequestInit) => tApp.fetch(new Request(`http://x${path}`, init));
    const lr = await treq("/api/admin/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: suName, password: "password123" }),
    });
    const t = ((await lr.json()) as { token: string }).token;
    const u1 = ((await (await treq("/api/me", { headers: bearer("Utest1") })).json()) as { userId: string }).userId;
    const school = (await (
      await treq("/api/admin/schools", {
        method: "POST",
        headers: { ...bearer(t), "content-type": "application/json" },
        body: JSON.stringify({ name: "テスト送信校", prefecture: "兵庫県" }),
      })
    ).json()) as { id: string };
    await treq(`/api/admin/users/${u1}/subscriptions`, {
      method: "POST",
      headers: { ...bearer(t), "content-type": "application/json" },
      body: JSON.stringify({ schoolId: school.id }),
    });

    const res = await treq(`/api/admin/schools/${school.id}/test-notify`, {
      method: "POST",
      headers: { ...bearer(t), "content-type": "application/json" },
      body: JSON.stringify({ result: "FULL_OFF", target: { type: "subscribers" } }),
    });
    expect(res.status).toBe(200);
    const summary = (await res.json()) as { total: number; sent: number; text: string };
    expect(summary.total).toBe(1);
    expect(summary.sent).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.lineUserId).toBe("Utest1");
    expect(summary.text).toContain("休校");

    // 履歴に送信本文・経路・成功時刻が記録される
    const notifs = (await (await treq(`/api/admin/notifications?schoolId=${school.id}`, { headers: bearer(t) })).json()) as { id: string; messageText: string; channel: string; sentAt: string | null }[];
    expect(notifs).toHaveLength(1);
    expect(notifs[0]?.channel).toBe("line");
    expect(notifs[0]?.sentAt).not.toBeNull();
    const detail = (await (await treq(`/api/admin/notifications/${notifs[0]!.id}`, { headers: bearer(t) })).json()) as { messageText: string; error: string | null };
    expect(detail.messageText).toContain("休校");
    expect(detail.error).toBeNull();
  });

  it("テスト送信: 指定LINEユーザーのみ・再送可能（毎回新規ruleIdで重複しない）", async () => {
    const sent: string[] = [];
    const tApp = createApp({
      db: drizzle(sql, { schema }),
      verifyIdToken: async (t) => ({ lineUserId: t }),
      adminJwtSecret: SECRET,
      notificationProvider: { send: async (target) => { sent.push(target.lineUserId ?? ""); } },
    });
    const treq = (path: string, init?: RequestInit) => tApp.fetch(new Request(`http://x${path}`, init));
    const lr = await treq("/api/admin/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: suName, password: "password123" }),
    });
    const t = ((await lr.json()) as { token: string }).token;
    const school = (await (
      await treq("/api/admin/schools", {
        method: "POST",
        headers: { ...bearer(t), "content-type": "application/json" },
        body: JSON.stringify({ name: "自分宛テスト校", prefecture: "兵庫県" }),
      })
    ).json()) as { id: string };

    const body = JSON.stringify({ result: "UNKNOWN", target: { type: "lineUser", lineUserId: "Uself" } });
    const r1 = await treq(`/api/admin/schools/${school.id}/test-notify`, { method: "POST", headers: { ...bearer(t), "content-type": "application/json" }, body });
    const r2 = await treq(`/api/admin/schools/${school.id}/test-notify`, { method: "POST", headers: { ...bearer(t), "content-type": "application/json" }, body });
    expect(((await r1.json()) as { sent: number }).sent).toBe(1);
    expect(((await r2.json()) as { sent: number }).sent).toBe(1); // 2回目も送れる（重複にならない）
    expect(sent).toEqual(["Uself", "Uself"]);
  });

  it("フラグ: 定義・一括付与/解除・一覧反映", async () => {
    const suT = await loginToken(suName);
    const { userId } = (await (await req("/api/me", { headers: bearer("Uflag1") })).json()) as { userId: string };
    // 定義作成
    expect((await req("/api/admin/flag-defs", {
      method: "POST", headers: { ...bearer(suT), "content-type": "application/json" },
      body: JSON.stringify({ name: "送信済み", color: "#1a73e8" }),
    })).status).toBe(201);
    const defs = (await (await req("/api/admin/flag-defs", { headers: bearer(suT) })).json()) as { name: string }[];
    expect(defs.some((d) => d.name === "送信済み")).toBe(true);
    // 付与
    const asg = await req("/api/admin/flags/assign", {
      method: "POST", headers: { ...bearer(suT), "content-type": "application/json" },
      body: JSON.stringify({ userIds: [userId], name: "送信済み" }),
    });
    expect(((await asg.json()) as { assigned: number }).assigned).toBe(1);
    // 一覧に反映
    const users = (await (await req("/api/admin/users", { headers: bearer(suT) })).json()) as { id: string; flags: string[] }[];
    expect(users.find((u) => u.id === userId)?.flags).toContain("送信済み");
    // ユーザー詳細にも反映
    const detail = (await (await req(`/api/admin/users/${userId}`, { headers: bearer(suT) })).json()) as { flags: string[] };
    expect(detail.flags).toContain("送信済み");
    // 解除
    await req("/api/admin/flags/unassign", {
      method: "POST", headers: { ...bearer(suT), "content-type": "application/json" },
      body: JSON.stringify({ userIds: [userId], name: "送信済み" }),
    });
    const users2 = (await (await req("/api/admin/users", { headers: bearer(suT) })).json()) as { id: string; flags: string[] }[];
    expect(users2.find((u) => u.id === userId)?.flags ?? []).not.toContain("送信済み");
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

  it("フローテンプレート: 作成→手動実行でフラグ付与→スケジュールCRUD", async () => {
    const suT = await loginToken(suName);
    const jsonHeaders = { ...bearer(suT), "content-type": "application/json" };
    // 対象ユーザーを用意し、絞り込み用フラグを付与
    const { userId } = (await (await req("/api/me", { headers: bearer("Uflowtarget") })).json()) as { userId: string };
    await req("/api/admin/flag-defs", { method: "POST", headers: jsonHeaders, body: JSON.stringify({ name: "flowtarget" }) });
    await req("/api/admin/flag-defs", { method: "POST", headers: jsonHeaders, body: JSON.stringify({ name: "flowdone" }) });
    await req("/api/admin/flags/assign", { method: "POST", headers: jsonHeaders, body: JSON.stringify({ userIds: [userId], name: "flowtarget" }) });

    // テンプレート作成（flowtarget を持つ人 → flowdone を付与）
    const tplBody = {
      name: "テストフロー",
      allUsers: false,
      query: { combinator: "and", filters: [{ id: "f1", field: "flag", op: "hasFlag", value: "flowtarget" }], sorts: [] },
      steps: [{ id: "s1", type: "addFlag", flag: "flowdone" }],
    };
    const created = await req("/api/admin/flow-templates", { method: "POST", headers: jsonHeaders, body: JSON.stringify(tplBody) });
    expect(created.status).toBe(201);
    const tpl = (await created.json()) as { id: string; name: string };
    expect(tpl.name).toBe("テストフロー");

    // 一覧
    const list = (await (await req("/api/admin/flow-templates", { headers: bearer(suT) })).json()) as { id: string }[];
    expect(list.some((x) => x.id === tpl.id)).toBe(true);

    // 手動実行 → flowdone が付与される
    const run = await req(`/api/admin/flow-templates/${tpl.id}/run`, { method: "POST", headers: bearer(suT) });
    expect(run.status).toBe(200);
    expect(((await run.json()) as { audienceCount: number }).audienceCount).toBe(1);
    const detail = (await (await req(`/api/admin/users/${userId}`, { headers: bearer(suT) })).json()) as { flags: string[] };
    expect(detail.flags).toContain("flowdone");

    // userIds 指定の個別実行: 対象条件(flowtarget)に該当しないユーザーにも実行される（ユーザー詳細から）
    const { userId: otherId } = (await (await req("/api/me", { headers: bearer("Uflowoverride") })).json()) as { userId: string };
    const runOne = await req(`/api/admin/flow-templates/${tpl.id}/run`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ userIds: [otherId] }),
    });
    expect(runOne.status).toBe(200);
    expect(((await runOne.json()) as { audienceCount: number }).audienceCount).toBe(1);
    const otherDetail = (await (await req(`/api/admin/users/${otherId}`, { headers: bearer(suT) })).json()) as { flags: string[] };
    expect(otherDetail.flags).toContain("flowdone"); // query 非該当でも userIds 指定で実行された

    // 更新
    const upd = await req(`/api/admin/flow-templates/${tpl.id}`, { method: "PATCH", headers: jsonHeaders, body: JSON.stringify({ ...tplBody, name: "更新後フロー" }) });
    expect(((await upd.json()) as { name: string }).name).toBe("更新後フロー");

    // スケジュール CRUD
    const sc = await req("/api/admin/flow-schedules", { method: "POST", headers: jsonHeaders, body: JSON.stringify({ templateId: tpl.id, time: "07:00", daysOfWeek: [1, 2, 3, 4, 5] }) });
    expect(sc.status).toBe(201);
    const sched = (await sc.json()) as { id: string; time: string };
    expect(sched.time).toBe("07:00");
    const scList = (await (await req(`/api/admin/flow-schedules?templateId=${tpl.id}`, { headers: bearer(suT) })).json()) as { id: string }[];
    expect(scList.some((x) => x.id === sched.id)).toBe(true);
    const patched = await req(`/api/admin/flow-schedules/${sched.id}`, { method: "PATCH", headers: jsonHeaders, body: JSON.stringify({ enabled: false }) });
    expect(((await patched.json()) as { enabled: boolean }).enabled).toBe(false);

    // 時刻バリデーション（:15 は不可）
    const bad = await req("/api/admin/flow-schedules", { method: "POST", headers: jsonHeaders, body: JSON.stringify({ templateId: tpl.id, time: "07:15", daysOfWeek: [] }) });
    expect(bad.status).toBe(400);

    // テンプレート削除でスケジュールも消える
    expect((await req(`/api/admin/flow-templates/${tpl.id}`, { method: "DELETE", headers: bearer(suT) })).status).toBe(204);
    const scList2 = (await (await req(`/api/admin/flow-schedules?templateId=${tpl.id}`, { headers: bearer(suT) })).json()) as unknown[];
    expect(scList2.length).toBe(0);
  });
});
