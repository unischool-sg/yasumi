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

  it("存在しない学校の購読 → 404", async () => {
    const res = await req("/api/me/subscriptions", {
      method: "POST",
      headers: { ...auth("Uapi3"), "content-type": "application/json" },
      body: JSON.stringify({ schoolId: "00000000-0000-0000-0000-000000000000" }),
    });
    expect(res.status).toBe(404);
  });
});
