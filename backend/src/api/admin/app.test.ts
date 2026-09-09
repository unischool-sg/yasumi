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
});
