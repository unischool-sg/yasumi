import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import type { Sql } from "postgres";
import { createApp } from "../app.ts";
import { createAdmin } from "../../infrastructure/db/repositories/admins.ts";
import * as schema from "../../infrastructure/db/schema.ts";

const TEST_DB = process.env.TEST_DATABASE_URL;
const suite = TEST_DB ? describe : describe.skip;

suite("School (teacher) API", () => {
  let sql: Sql;
  let app: ReturnType<typeof createApp>;
  const ADMIN_SECRET = "test-admin-secret";
  const SCHOOL_SECRET = "test-school-secret";
  const req = (path: string, init?: RequestInit) => app.fetch(new Request(`http://x${path}`, init));
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const suName = `su_${Math.random().toString(36).slice(2, 8)}`;
  const emailA = `t_${Math.random().toString(36).slice(2, 8)}@a.example`;

  let adminToken = "";
  let schoolAId = "";
  let schoolBId = "";

  beforeAll(async () => {
    sql = postgres(TEST_DB!, { max: 1 });
    const db = drizzle(sql, { schema });
    await migrate(db, { migrationsFolder: join(import.meta.dir, "../../../drizzle") });
    await createAdmin(db, { username: suName, passwordHash: await Bun.password.hash("password123"), role: "superadmin" });
    app = createApp({
      db,
      verifyIdToken: async (t) => ({ lineUserId: t }),
      adminJwtSecret: ADMIN_SECRET,
      schoolJwtSecret: SCHOOL_SECRET,
    });
    // admin ログイン
    const res = await req("/api/admin/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: suName, password: "password123" }),
    });
    adminToken = ((await res.json()) as { token: string }).token;
    // 学校 A / B を作成
    const mk = async (name: string) =>
      ((await (
        await req("/api/admin/schools", {
          method: "POST",
          headers: { ...bearer(adminToken), "content-type": "application/json" },
          body: JSON.stringify({ name, prefecture: "兵庫県" }),
        })
      ).json()) as { id: string }).id;
    schoolAId = await mk("テナントA校");
    schoolBId = await mk("テナントB校");
  });
  afterAll(async () => {
    await sql?.end();
  });

  it("admin が教員アカウントを発行（passwordHash は返さない）＋プラン付与", async () => {
    const res = await req(`/api/admin/schools/${schoolAId}/teachers`, {
      method: "POST",
      headers: { ...bearer(adminToken), "content-type": "application/json" },
      body: JSON.stringify({ email: emailA, password: "teacherpass1", name: "先生A", role: "owner" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.schoolId).toBe(schoolAId);
    expect(body.passwordHash).toBeUndefined();

    // premium プランを付与
    const plan = await req(`/api/admin/schools/${schoolAId}`, {
      method: "PATCH",
      headers: { ...bearer(adminToken), "content-type": "application/json" },
      body: JSON.stringify({ plan: "premium", planExpiresAt: "2027-03-31T00:00:00.000Z" }),
    });
    expect(plan.status).toBe(200);
  });

  it("誤ったパスワード → 401 / 正しいと token", async () => {
    const bad = await req("/api/school/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: emailA, password: "wrong" }),
    });
    expect(bad.status).toBe(401);

    const ok = await req("/api/school/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: emailA, password: "teacherpass1" }),
    });
    expect(ok.status).toBe(200);
  });

  it("認証なしの /api/school/me → 401", async () => {
    expect((await req("/api/school/me")).status).toBe(401);
  });

  it("/api/school/me は自校とプランを返す（テナント境界）", async () => {
    const login = await req("/api/school/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: emailA, password: "teacherpass1" }),
    });
    const { token } = (await login.json()) as { token: string };
    const me = (await (await req("/api/school/me", { headers: bearer(token) })).json()) as {
      teacher: { schoolId: string; role: string };
      school: { id: string; plan: string | null } | null;
    };
    expect(me.teacher.schoolId).toBe(schoolAId);
    expect(me.teacher.role).toBe("owner");
    expect(me.school?.id).toBe(schoolAId);
    expect(me.school?.id).not.toBe(schoolBId);
    expect(me.school?.plan).toBe("premium");
  });

  it("公式送信: 自校購読者へ送り、履歴(到達状況)に記録される", async () => {
    // 送信プロバイダを捕捉する別アプリ（同一DB・同一SCHOOL_SECRET）
    const sent: { lineUserId?: string; text: string }[] = [];
    const msgApp = createApp({
      db: drizzle(sql, { schema }),
      verifyIdToken: async (t) => ({ lineUserId: t }),
      adminJwtSecret: ADMIN_SECRET,
      schoolJwtSecret: SCHOOL_SECRET,
      notificationProvider: {
        async send(target, message) {
          sent.push({ ...(target.lineUserId ? { lineUserId: target.lineUserId } : {}), text: message.text });
        },
      },
    });
    const mreq = (path: string, init?: RequestInit) => msgApp.fetch(new Request(`http://x${path}`, init));

    // LINEユーザーを作成し、admin 経由で学校Aを購読させる
    const { userId } = (await (await mreq("/api/me", { headers: bearer("Uschoolbcast") })).json()) as { userId: string };
    await mreq(`/api/admin/users/${userId}/subscriptions`, {
      method: "POST",
      headers: { ...bearer(adminToken), "content-type": "application/json" },
      body: JSON.stringify({ schoolId: schoolAId }),
    });

    // 教員ログイン → 送信
    const login = await mreq("/api/school/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: emailA, password: "teacherpass1" }),
    });
    const { token } = (await login.json()) as { token: string };

    const bc = await mreq("/api/school/broadcast", {
      method: "POST",
      headers: { ...bearer(token), "content-type": "application/json" },
      body: JSON.stringify({ text: "本日は暴風警報のため休校です", category: "emergency" }),
    });
    expect(bc.status).toBe(200);
    const result = (await bc.json()) as { total: number; sent: number; failed: number };
    expect(result.total).toBeGreaterThanOrEqual(1);
    expect(result.sent).toBeGreaterThanOrEqual(1);
    expect(sent.some((s) => s.lineUserId === "Uschoolbcast")).toBe(true);

    // 購読者一覧に出る
    const subs = (await (await mreq("/api/school/subscribers", { headers: bearer(token) })).json()) as { userId: string }[];
    expect(subs.some((s) => s.userId === userId)).toBe(true);

    // 履歴に記録される
    const history = (await (await mreq("/api/school/messages", { headers: bearer(token) })).json()) as {
      category: string; text: string; total: number; sent: number;
    }[];
    expect(history.some((m) => m.category === "emergency" && m.text.includes("休校"))).toBe(true);
  });

  it("欠席受付: premium校のみ受付・警報自動タグ・テナントスコープ", async () => {
    const db = drizzle(sql, { schema });
    // LIFF ユーザー
    const { userId } = (await (await req("/api/me", { headers: bearer("Uabsence") })).json()) as { userId: string };

    // 学校A（premium）にプロフィール作成
    const profRes = await req("/api/me/student-profiles", {
      method: "POST",
      headers: { ...bearer("Uabsence"), "content-type": "application/json" },
      body: JSON.stringify({ schoolId: schoolAId, studentName: "山田太郎", grade: "2年", className: "A組" }),
    });
    expect(profRes.status).toBe(201);
    const profile = (await profRes.json()) as { id: string };

    // 欠席送信（警報なし → warningActive=false）
    const abs = await req("/api/me/absence-reports", {
      method: "POST",
      headers: { ...bearer("Uabsence"), "content-type": "application/json" },
      body: JSON.stringify({ schoolId: schoolAId, studentProfileId: profile.id, date: "2026-09-11", type: "欠席", reason: "発熱のため" }),
    });
    expect(abs.status).toBe(201);
    expect(((await abs.json()) as { warningActive: boolean }).warningActive).toBe(false);

    // school mismatch → 400（Aのプロフィールで schoolId=B）
    const mism = await req("/api/me/absence-reports", {
      method: "POST",
      headers: { ...bearer("Uabsence"), "content-type": "application/json" },
      body: JSON.stringify({ schoolId: schoolBId, studentProfileId: profile.id, date: "2026-09-11", type: "欠席" }),
    });
    expect(mism.status).toBe(400);

    // 非premium校（B）へは 403（Bのプロフィールを作って送る）
    const profB = (await (await req("/api/me/student-profiles", {
      method: "POST",
      headers: { ...bearer("Uabsence"), "content-type": "application/json" },
      body: JSON.stringify({ schoolId: schoolBId, studentName: "鈴木花子" }),
    })).json()) as { id: string };
    const absB = await req("/api/me/absence-reports", {
      method: "POST",
      headers: { ...bearer("Uabsence"), "content-type": "application/json" },
      body: JSON.stringify({ schoolId: schoolBId, studentProfileId: profB.id, date: "2026-09-11", type: "欠席" }),
    });
    expect(absB.status).toBe(403);

    // 警報自動タグ: 警報ありの日に「休校」→ warningActive=true
    await db.insert(schema.warningChecks).values({
      schoolId: schoolAId,
      ruleId: crypto.randomUUID(),
      targetDate: "2026-09-12",
      checkedAt: new Date(),
      warningActive: true,
      result: "FULL_OFF",
    });
    const absW = await req("/api/me/absence-reports", {
      method: "POST",
      headers: { ...bearer("Uabsence"), "content-type": "application/json" },
      body: JSON.stringify({ schoolId: schoolAId, studentProfileId: profile.id, date: "2026-09-12", type: "休校" }),
    });
    expect(((await absW.json()) as { warningActive: boolean }).warningActive).toBe(true);

    // 教員A: 受信箱に自校の欠席（氏名付き）が出る
    const login = await req("/api/school/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: emailA, password: "teacherpass1" }),
    });
    const { token: tA } = (await login.json()) as { token: string };
    const inbox = (await (await req("/api/school/absences", { headers: bearer(tA) })).json()) as {
      id: string; studentName: string; status: string; type: string;
    }[];
    expect(inbox.some((r) => r.studentName === "山田太郎")).toBe(true);
    const target = inbox.find((r) => r.studentName === "山田太郎")!;

    // 確認済みに更新
    const patch = await req(`/api/school/absences/${target.id}`, {
      method: "PATCH",
      headers: { ...bearer(tA), "content-type": "application/json" },
      body: JSON.stringify({ status: "confirmed" }),
    });
    expect(patch.status).toBe(200);

    // テナント越境: 学校Bの教員はAの欠席を見られない・更新できない
    await req(`/api/admin/schools/${schoolBId}/teachers`, {
      method: "POST",
      headers: { ...bearer(adminToken), "content-type": "application/json" },
      body: JSON.stringify({ email: `b_${Math.random().toString(36).slice(2, 8)}@b.example`, password: "teacherpassB", name: "先生B", role: "owner" }),
    });
    const listB = (await (await req(`/api/admin/schools/${schoolBId}/teachers`, { headers: bearer(adminToken) })).json()) as { email: string }[];
    const emailB = listB[0]!.email;
    const loginB = await req("/api/school/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: emailB, password: "teacherpassB" }),
    });
    const { token: tB } = (await loginB.json()) as { token: string };
    const inboxB = (await (await req("/api/school/absences", { headers: bearer(tB) })).json()) as { id: string }[];
    expect(inboxB.some((r) => r.id === target.id)).toBe(false);
    const crossPatch = await req(`/api/school/absences/${target.id}`, {
      method: "PATCH",
      headers: { ...bearer(tB), "content-type": "application/json" },
      body: JSON.stringify({ status: "confirmed" }),
    });
    expect(crossPatch.status).toBe(404);
  });

  it("任意送信(お知らせ)の月間上限: basic=10通で11通目は403・緊急は無制限", async () => {
    // basic プランの学校Cと教員を用意
    const schoolCId = ((await (
      await req("/api/admin/schools", {
        method: "POST",
        headers: { ...bearer(adminToken), "content-type": "application/json" },
        body: JSON.stringify({ name: "通数テスト校", prefecture: "兵庫県" }),
      })
    ).json()) as { id: string }).id;
    await req(`/api/admin/schools/${schoolCId}`, {
      method: "PATCH",
      headers: { ...bearer(adminToken), "content-type": "application/json" },
      body: JSON.stringify({ plan: "basic" }),
    });
    const emailC = `c_${Math.random().toString(36).slice(2, 8)}@c.example`;
    await req(`/api/admin/schools/${schoolCId}/teachers`, {
      method: "POST",
      headers: { ...bearer(adminToken), "content-type": "application/json" },
      body: JSON.stringify({ email: emailC, password: "teacherpassC", name: "先生C", role: "owner" }),
    });
    const { token: tC } = (await (await req("/api/school/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: emailC, password: "teacherpassC" }),
    })).json()) as { token: string };

    const announce = () => req("/api/school/broadcast", {
      method: "POST",
      headers: { ...bearer(tC), "content-type": "application/json" },
      body: JSON.stringify({ text: "お知らせ", category: "announcement" }),
    });

    // 10通は成功（購読者0なので total=0 でも記録される）
    for (let i = 0; i < 10; i++) expect((await announce()).status).toBe(200);
    // 11通目は上限で 403
    expect((await announce()).status).toBe(403);
    // 緊急は上限に関係なく送れる
    const emg = await req("/api/school/broadcast", {
      method: "POST",
      headers: { ...bearer(tC), "content-type": "application/json" },
      body: JSON.stringify({ text: "休校連絡", category: "emergency" }),
    });
    expect(emg.status).toBe(200);
    // quota は used=10, limit=10
    const quota = (await (await req("/api/school/quota", { headers: bearer(tC) })).json()) as {
      announcement: { used: number; limit: number | null };
    };
    expect(quota.announcement).toEqual({ used: 10, limit: 10 });
  });

  it("テンプレート: 作成・一覧（自校スコープ）・削除", async () => {
    const { token } = (await (await req("/api/school/auth/login", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: emailA, password: "teacherpass1" }),
    })).json()) as { token: string };
    const created = await req("/api/school/templates", {
      method: "POST", headers: { ...bearer(token), "content-type": "application/json" },
      body: JSON.stringify({ title: "暴風警報休校", category: "emergency", body: "本日は暴風警報のため休校です。" }),
    });
    expect(created.status).toBe(201);
    const t = (await created.json()) as { id: string };
    const list = (await (await req("/api/school/templates", { headers: bearer(token) })).json()) as { id: string; title: string }[];
    expect(list.some((x) => x.id === t.id && x.title === "暴風警報休校")).toBe(true);
    expect((await req(`/api/school/templates/${t.id}`, { method: "DELETE", headers: bearer(token) })).status).toBe(204);
  });

  it("確認ボタン: requireConfirmation 送信→/c/:token→confirmedCount 反映", async () => {
    const captured: { text: string; url?: string }[] = [];
    const cApp = createApp({
      db: drizzle(sql, { schema }),
      verifyIdToken: async (t) => ({ lineUserId: t }),
      adminJwtSecret: ADMIN_SECRET,
      schoolJwtSecret: SCHOOL_SECRET,
      apiBaseUrl: "http://x",
      notificationProvider: { async send(_t, m) { captured.push({ text: m.text, ...(m.action ? { url: m.action.url } : {}) }); } },
    });
    const creq = (path: string, init?: RequestInit) => cApp.fetch(new Request(`http://x${path}`, init));

    // 購読者を用意
    const { userId } = (await (await creq("/api/me", { headers: bearer("Uconfirm") })).json()) as { userId: string };
    await creq(`/api/admin/users/${userId}/subscriptions`, {
      method: "POST", headers: { ...bearer(adminToken), "content-type": "application/json" },
      body: JSON.stringify({ schoolId: schoolAId }),
    });
    const { token } = (await (await creq("/api/school/auth/login", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: emailA, password: "teacherpass1" }),
    })).json()) as { token: string };

    const bc = await creq("/api/school/broadcast", {
      method: "POST", headers: { ...bearer(token), "content-type": "application/json" },
      body: JSON.stringify({ text: "本日は休校です", category: "emergency", requireConfirmation: true }),
    });
    const { id: msgId } = (await bc.json()) as { id: string };
    // 確認リンクは Flex ボタンの action.url として送られる
    const withUrl = captured.find((c) => c.url?.includes("/c/"))!;
    expect(withUrl.url).toContain("http://x/c/");
    const confirmPath = withUrl.url!.match(/\/c\/([A-Za-z0-9._-]+)/)![0];

    // 確認前は 0
    let hist = (await (await creq("/api/school/messages", { headers: bearer(token) })).json()) as { id: string; confirmedCount: number }[];
    expect(hist.find((m) => m.id === msgId)?.confirmedCount).toBe(0);

    // リンクを叩く（確認）
    expect((await creq(confirmPath)).status).toBe(200);

    // 確認後は 1（冪等: 2回叩いても1）
    await creq(confirmPath);
    hist = (await (await creq("/api/school/messages", { headers: bearer(token) })).json()) as { id: string; confirmedCount: number }[];
    expect(hist.find((m) => m.id === msgId)?.confirmedCount).toBe(1);
  });

  it("休校ドラフト: 一覧・送信・却下（自校スコープ）", async () => {
    const db = drizzle(sql, { schema });
    const { token } = (await (await req("/api/school/auth/login", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: emailA, password: "teacherpass1" }),
    })).json()) as { token: string };

    // 判定パイプライン相当: ドラフトを直接投入
    await db.insert(schema.closureDrafts).values({
      schoolId: schoolAId, targetDate: "2026-09-15", result: "FULL_OFF", text: "本日は全日休校です。", status: "pending",
    });
    const drafts = (await (await req("/api/school/drafts", { headers: bearer(token) })).json()) as { id: string; result: string }[];
    const d = drafts.find((x) => x.result === "FULL_OFF");
    expect(d).toBeDefined();

    // 送信 → sent 化して一覧から消える
    const send = await req(`/api/school/drafts/${d!.id}/send`, {
      method: "POST", headers: { ...bearer(token), "content-type": "application/json" }, body: JSON.stringify({}),
    });
    expect(send.status).toBe(200);
    const after = (await (await req("/api/school/drafts", { headers: bearer(token) })).json()) as { id: string }[];
    expect(after.some((x) => x.id === d!.id)).toBe(false);

    // 別校のドラフトは送信できない（テナント越境404）
    await db.insert(schema.closureDrafts).values({
      schoolId: schoolBId, targetDate: "2026-09-15", result: "FULL_OFF", text: "B校休校", status: "pending",
    });
    const bDraft = (await db.select().from(schema.closureDrafts)
      .where(and(eq(schema.closureDrafts.schoolId, schoolBId), eq(schema.closureDrafts.status, "pending")))).at(0)!;
    const cross = await req(`/api/school/drafts/${bDraft.id}/dismiss`, {
      method: "POST", headers: bearer(token),
    });
    expect(cross.status).toBe(404);
  });

  it("ロゴ: admin アップロード→/public/school-logo 配信→/public/schools に logoUrl/verified", async () => {
    const store = new Map<string, Uint8Array>();
    const fakeStorage = {
      async put(key: string, data: ArrayBuffer | Uint8Array) {
        store.set(key, data instanceof Uint8Array ? data : new Uint8Array(data));
      },
      async get(key: string) {
        return store.get(key) ?? null;
      },
      async delete(key: string) {
        store.delete(key);
      },
    };
    const lapp = createApp({
      db: drizzle(sql, { schema }),
      verifyIdToken: async (t) => ({ lineUserId: t }),
      adminJwtSecret: ADMIN_SECRET,
      schoolJwtSecret: SCHOOL_SECRET,
      apiBaseUrl: "http://x",
      storage: fakeStorage,
    });
    const lreq = (path: string, init?: RequestInit) => lapp.fetch(new Request(`http://x${path}`, init));

    const dataBase64 = Buffer.from("PNGDATA").toString("base64");
    // 非対応形式 → 400
    const bad = await lreq(`/api/admin/schools/${schoolAId}/logo`, {
      method: "POST", headers: { ...bearer(adminToken), "content-type": "application/json" },
      body: JSON.stringify({ contentType: "application/pdf", dataBase64 }),
    });
    expect(bad.status).toBe(400);
    // png アップロード
    const up = await lreq(`/api/admin/schools/${schoolAId}/logo`, {
      method: "POST", headers: { ...bearer(adminToken), "content-type": "application/json" },
      body: JSON.stringify({ contentType: "image/png", dataBase64 }),
    });
    expect(up.status).toBe(200);
    expect(((await up.json()) as { logoKey: string }).logoKey).toBe(`logos/${schoolAId}.png`);

    // 配信
    const img = await lreq(`/public/school-logo/${schoolAId}`);
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await img.arrayBuffer())).toEqual(new Uint8Array(Buffer.from("PNGDATA")));

    // 公開一覧に logoUrl / verified(プラン有効)
    const list = (await (await lreq("/public/schools")).json()) as { id: string; logoUrl: string | null; verified: boolean }[];
    const a = list.find((s) => s.id === schoolAId)!;
    expect(a.logoUrl).toBe(`http://x/public/school-logo/${schoolAId}`);
    expect(a.verified).toBe(true);
  });

  it("ロゴ storage 未設定なら 503", async () => {
    const res = await req(`/api/admin/schools/${schoolAId}/logo`, {
      method: "POST", headers: { ...bearer(adminToken), "content-type": "application/json" },
      body: JSON.stringify({ contentType: "image/png", dataBase64: "AAAA" }),
    });
    expect(res.status).toBe(503);
  });

  // 指定プランの学校＋owner(admin発行)を作り、owner のログイン token を返す
  async function makeSchoolWithOwner(plan: string): Promise<{ schoolId: string; token: string }> {
    const schoolId = ((await (await req("/api/admin/schools", {
      method: "POST", headers: { ...bearer(adminToken), "content-type": "application/json" },
      body: JSON.stringify({ name: `${plan}校_${Math.random().toString(36).slice(2, 6)}`, prefecture: "兵庫県" }),
    })).json()) as { id: string }).id;
    await req(`/api/admin/schools/${schoolId}`, {
      method: "PATCH", headers: { ...bearer(adminToken), "content-type": "application/json" },
      body: JSON.stringify({ plan }),
    });
    const email = `owner_${Math.random().toString(36).slice(2, 8)}@x.example`;
    await req(`/api/admin/schools/${schoolId}/teachers`, {
      method: "POST", headers: { ...bearer(adminToken), "content-type": "application/json" },
      body: JSON.stringify({ email, password: "ownerpass12", name: "校長", role: "owner" }),
    });
    const token = ((await (await req("/api/school/auth/login", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "ownerpass12" }),
    })).json()) as { token: string }).token;
    return { schoolId, token };
  }

  it("職員席上限: basic は owner 自己管理 402 / standard は席5超で 409", async () => {
    const addTeacher = (token: string) => req("/api/school/teachers", {
      method: "POST", headers: { ...bearer(token), "content-type": "application/json" },
      body: JSON.stringify({ email: `t_${Math.random().toString(36).slice(2, 8)}@x.example`, password: "teacherpass9", name: "先生", role: "teacher" }),
    });
    // basic: 自己管理はスタンダード以上のみ → 402
    const basic = await makeSchoolWithOwner("basic");
    expect((await addTeacher(basic.token)).status).toBe(402);
    // standard: 上限5。owner=1 なので +4 は成功、5人追加目（合計6）で 409
    const std = await makeSchoolWithOwner("standard");
    for (let i = 0; i < 4; i++) expect((await addTeacher(std.token)).status).toBe(201);
    expect((await addTeacher(std.token)).status).toBe(409);
  });

  it("owner が自校の教員を自己管理（standard+）", async () => {
    // 学校A は premium。owner=emailA でログイン
    const { token } = (await (await req("/api/school/auth/login", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: emailA, password: "teacherpass1" }),
    })).json()) as { token: string };
    const email = `owneradd_${Math.random().toString(36).slice(2, 7)}@a.example`;
    const add = await req("/api/school/teachers", {
      method: "POST", headers: { ...bearer(token), "content-type": "application/json" },
      body: JSON.stringify({ email, password: "ownadd12345", name: "追加先生", role: "teacher" }),
    });
    expect(add.status).toBe(201);
    expect(((await add.json()) as Record<string, unknown>).passwordHash).toBeUndefined();
    const list = (await (await req("/api/school/teachers", { headers: bearer(token) })).json()) as { email: string }[];
    expect(list.some((t) => t.email === email)).toBe(true);
    // 追加した教員(role=teacher)は owner 管理不可（403）
    const teacherLogin = (await (await req("/api/school/auth/login", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "ownadd12345" }),
    })).json()) as { token: string };
    expect((await req("/api/school/teachers", { headers: bearer(teacherLogin.token) })).status).toBe(403);
  });

  it("セグメント配信＋分類(kind)＋CSV（M19/M20/M21）", async () => {
    const sent: string[] = [];
    const app2 = createApp({
      db: drizzle(sql, { schema }),
      verifyIdToken: async (t) => ({ lineUserId: t }),
      adminJwtSecret: ADMIN_SECRET,
      schoolJwtSecret: SCHOOL_SECRET,
      notificationProvider: { async send(t) { if (t.lineUserId) sent.push(t.lineUserId); } },
    });
    const r2 = (p: string, i?: RequestInit) => app2.fetch(new Request(`http://x${p}`, i));
    // 2ユーザー: 学年1/学年2 のプロフィール＋購読（学校Aはpremium）
    for (const { u, grade } of [{ u: "Useg1", grade: "1年" }, { u: "Useg2", grade: "2年" }]) {
      const { userId } = (await (await r2("/api/me", { headers: bearer(u) })).json()) as { userId: string };
      await r2("/api/me/student-profiles", {
        method: "POST", headers: { ...bearer(u), "content-type": "application/json" },
        body: JSON.stringify({ schoolId: schoolAId, studentName: "生徒", grade, className: "A" }),
      });
      await r2(`/api/admin/users/${userId}/subscriptions`, {
        method: "POST", headers: { ...bearer(adminToken), "content-type": "application/json" },
        body: JSON.stringify({ schoolId: schoolAId }),
      });
    }
    const { token } = (await (await r2("/api/school/auth/login", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: emailA, password: "teacherpass1" }),
    })).json()) as { token: string };
    // 1年だけに配信（kind=closure）
    const bc = await r2("/api/school/broadcast", {
      method: "POST", headers: { ...bearer(token), "content-type": "application/json" },
      body: JSON.stringify({ text: "1年生へ", category: "emergency", kind: "closure", target: { grade: "1年" } }),
    });
    expect(bc.status).toBe(200);
    expect(sent).toContain("Useg1");
    expect(sent).not.toContain("Useg2");
    // 履歴に kind
    const hist = (await (await r2("/api/school/messages", { headers: bearer(token) })).json()) as { kind: string }[];
    expect(hist.some((m) => m.kind === "closure")).toBe(true);
    // 数式インジェクション対策の確認: 先頭 = のメッセージを送って CSV で ' 無害化されること
    await r2("/api/school/broadcast", {
      method: "POST", headers: { ...bearer(token), "content-type": "application/json" },
      body: JSON.stringify({ text: "=HACK()", category: "emergency" }),
    });
    // CSV（A=premium）→ 200 text/csv
    const csv = await r2("/api/school/messages.csv", { headers: bearer(token) });
    expect(csv.status).toBe(200);
    expect(csv.headers.get("content-type")).toContain("text/csv");
    const body = await csv.text();
    expect(body).toContain("'=HACK()"); // 数式が ' で無害化されている
    expect(body).not.toMatch(/(^|,)=HACK\(\)/); // 生の =HACK() でセルが始まらない
  });

  it("CSV は非premiumで 402", async () => {
    const std = await makeSchoolWithOwner("standard");
    expect((await req("/api/school/messages.csv", { headers: bearer(std.token) })).status).toBe(402);
  });

  it("無効化された教員はログイン不可＋既存トークンも即失効（disabled → 401）", async () => {
    // 無効化する前に一度ログインしてトークンを取得
    const pre = await req("/api/school/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: emailA, password: "teacherpass1" }),
    });
    const { token: oldToken } = (await pre.json()) as { token: string };
    expect((await req("/api/school/me", { headers: bearer(oldToken) })).status).toBe(200);

    // 対象教員IDを取得して無効化
    const list = (await (
      await req(`/api/admin/schools/${schoolAId}/teachers`, { headers: bearer(adminToken) })
    ).json()) as { id: string; email: string }[];
    const target = list.find((t) => t.email === emailA)!;
    const patch = await req(`/api/admin/teachers/${target.id}`, {
      method: "PATCH",
      headers: { ...bearer(adminToken), "content-type": "application/json" },
      body: JSON.stringify({ disabled: true }),
    });
    expect(patch.status).toBe(200);

    // 新規ログインは不可
    const login = await req("/api/school/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: emailA, password: "teacherpass1" }),
    });
    expect(login.status).toBe(401);
    // 発行済みトークンも即失効（毎リクエスト DB 再検証）
    expect((await req("/api/school/me", { headers: bearer(oldToken) })).status).toBe(401);
  });
});
