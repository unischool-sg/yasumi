import { join } from "node:path";
import { renderMessageTemplate, templateReferencesVariable } from "@yasumi/shared";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import type { Sql } from "postgres";
import type { Db } from "../../infrastructure/db/client.ts";
import { createSchool } from "../../infrastructure/db/repositories/schools.ts";
import { upsertSubscription } from "../../infrastructure/db/repositories/subscriptions.ts";
import { findOrCreateByLineUserId } from "../../infrastructure/db/repositories/users.ts";
import * as schema from "../../infrastructure/db/schema.ts";
import { makeMessageRenderer } from "./render.ts";

describe("renderMessageTemplate (pure)", () => {
  it("値があれば置換、無ければ既定語、未知変数は空", () => {
    const text = "{{name}}さん、{{school}}は{{today}}({{weekday}})です。{{unknown}}";
    const out = renderMessageTemplate(text, { name: "太郎", school: "三田学園", today: "2026-09-13", weekday: "日" });
    expect(out).toBe("太郎さん、三田学園は2026-09-13(日)です。");
  });
  it("name 未解決 → 既定語「みなさん」", () => {
    expect(renderMessageTemplate("{{name}}へ", { name: undefined })).toBe("みなさんへ");
    expect(renderMessageTemplate("{{name}}へ", { name: "" })).toBe("みなさんへ");
  });
  it("templateReferencesVariable", () => {
    expect(templateReferencesVariable("hi {{ name }}", "name")).toBe(true);
    expect(templateReferencesVariable("hi", "name")).toBe(false);
  });
});

const TEST_DB = process.env.TEST_DATABASE_URL;
const suite = TEST_DB ? describe : describe.skip;

suite("makeMessageRenderer (DB)", () => {
  let sql: Sql;
  let db: Db;
  const at = new Date("2026-09-13T09:00:00+09:00"); // 日曜

  beforeAll(async () => {
    sql = postgres(TEST_DB!, { max: 1 });
    db = drizzle(sql, { schema });
    await migrate(db, { migrationsFolder: join(import.meta.dir, "../../../drizzle") });
  });
  afterAll(async () => {
    await sql?.end();
  });

  it("{{name}} は LINE プロフィール、{{school}} は購読校、日付/曜日を置換", async () => {
    const school = await createSchool(db, { name: "レンダー校", prefecture: "兵庫県" });
    const { userId } = await findOrCreateByLineUserId(db, "Urender1");
    await upsertSubscription(db, { userId, schoolId: school.id });

    // LINE プロフィール取得をモック
    const fetchFn = async () =>
      new Response(JSON.stringify({ displayName: "花子" }), { status: 200 });

    const render = makeMessageRenderer(
      { db, lineAccessToken: "tok", fetchFn, now: () => at },
      {},
    );
    const out = await render(userId, "{{name}}さん、{{school}}／{{today}}({{weekday}})");
    expect(out).toBe("花子さん、レンダー校／2026-09-13(日)");
  });

  it("ctx.schoolName があれば {{school}} に優先採用", async () => {
    const { userId } = await findOrCreateByLineUserId(db, "Urender2");
    const render = makeMessageRenderer({ db, now: () => at }, { schoolName: "対象校A" });
    const out = await render(userId, "{{school}} からのお知らせ");
    expect(out).toBe("対象校A からのお知らせ");
  });

  it("name が取得できない（トークン無し）→ 既定語", async () => {
    const { userId } = await findOrCreateByLineUserId(db, "Urender3");
    const render = makeMessageRenderer({ db, now: () => at }, {});
    const out = await render(userId, "こんにちは {{name}}");
    expect(out).toBe("こんにちは みなさん");
  });

  it("変数が無ければそのまま返す", async () => {
    const { userId } = await findOrCreateByLineUserId(db, "Urender4");
    const render = makeMessageRenderer({ db, now: () => at }, {});
    expect(await render(userId, "ただのお知らせ")).toBe("ただのお知らせ");
  });
});
