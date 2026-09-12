import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import type { Sql } from "postgres";
import type { Db } from "../infrastructure/db/client.ts";
import * as flagsRepo from "../infrastructure/db/repositories/flags.ts";
import * as schedulesRepo from "../infrastructure/db/repositories/flow-schedules.ts";
import * as templatesRepo from "../infrastructure/db/repositories/flow-templates.ts";
import { findOrCreateByLineUserId } from "../infrastructure/db/repositories/users.ts";
import * as schema from "../infrastructure/db/schema.ts";
import { runFlows } from "./run-flows.ts";

const TEST_DB = process.env.TEST_DATABASE_URL;
const suite = TEST_DB ? describe : describe.skip;

// 2026-09-14 は月曜。07:00 JST に発火する想定。
const MON_0700 = new Date("2026-09-14T07:00:00+09:00");
const TUE_0700 = new Date("2026-09-15T07:00:00+09:00");

suite("runFlows pipeline", () => {
  let sql: Sql;
  let db: Db;

  beforeAll(async () => {
    sql = postgres(TEST_DB!, { max: 1 });
    db = drizzle(sql, { schema });
    await migrate(db, { migrationsFolder: join(import.meta.dir, "../../drizzle") });
  });
  afterAll(async () => {
    await sql?.end();
  });

  it("時刻・曜日一致でフローを実行し、Discord ログを送る／二重実行しない／曜日外は実行しない", async () => {
    // 対象ユーザー＋フラグ
    const { userId } = await findOrCreateByLineUserId(db, "Uflowcron");
    await flagsRepo.createDef(db, { name: "cron-target" });
    await flagsRepo.createDef(db, { name: "cron-done" });
    await flagsRepo.assign(db, [userId], "cron-target");

    const tpl = await templatesRepo.createTemplate(db, {
      name: "毎朝フロー",
      allUsers: false,
      query: { combinator: "and", filters: [{ id: "f1", field: "flag", op: "hasFlag", value: "cron-target" }], sorts: [] },
      steps: [{ id: "s1", type: "addFlag", flag: "cron-done" }],
    });
    // 月〜金 07:00
    const schedule = await schedulesRepo.createSchedule(db, { templateId: tpl.id, time: "07:00", daysOfWeek: [1, 2, 3, 4, 5] });

    const posted: { url: string; body: string }[] = [];
    const fetchFn = async (url: string, init?: RequestInit) => {
      posted.push({ url, body: String(init?.body ?? "") });
      return new Response("{}", { status: 204 });
    };
    const deps = {
      db,
      discordFlowWebhookUrl: "https://discord.example/webhook",
      adminBaseUrl: "https://admin.example",
      fetchFn,
      now: () => MON_0700,
    };

    // 月曜 07:00 → 実行
    const s1 = await runFlows(deps, { triggeredAt: MON_0700 });
    expect(s1.flowsRun).toBe(1);
    const detail = await flagsRepo.listByUsers(db, [userId]);
    expect(detail.get(userId) ?? []).toContain("cron-done");

    // Discord ログに対象者URL・テンプレURL・操作内容が載る
    expect(posted.length).toBe(1);
    const logged = posted[0]!.body;
    expect(logged).toContain(`https://admin.example/users/${userId}`);
    expect(logged).toContain("https://admin.example/flows");
    expect(logged).toContain("フラグ付与");

    // 同日同時刻に再発火しても二重実行しない
    const s2 = await runFlows(deps, { triggeredAt: MON_0700 });
    expect(s2.flowsRun).toBe(0);

    // 曜日外（金→土に変更）は実行しない
    await schedulesRepo.updateSchedule(db, schedule.id, { daysOfWeek: [6] });
    const s3 = await runFlows(deps, { triggeredAt: TUE_0700 });
    expect(s3.flowsRun).toBe(0);
  });
});
