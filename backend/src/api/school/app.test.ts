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

  it("無効化された教員はログイン不可（disabled → 401）", async () => {
    // 対象教員IDを取得
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

    const login = await req("/api/school/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: emailA, password: "teacherpass1" }),
    });
    expect(login.status).toBe(401);
  });
});
