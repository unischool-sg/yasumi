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
