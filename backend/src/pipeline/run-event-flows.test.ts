import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import type { Sql } from "postgres";
import type { NotificationProvider } from "../domain/notification/provider.ts";
import type { Db } from "../infrastructure/db/client.ts";
import * as flagsRepo from "../infrastructure/db/repositories/flags.ts";
import * as triggersRepo from "../infrastructure/db/repositories/flow-event-triggers.ts";
import * as templatesRepo from "../infrastructure/db/repositories/flow-templates.ts";
import * as flowRunLogsRepo from "../infrastructure/db/repositories/flow-run-logs.ts";
import { createSchool } from "../infrastructure/db/repositories/schools.ts";
import { upsertSubscription } from "../infrastructure/db/repositories/subscriptions.ts";
import { findOrCreateByLineUserId } from "../infrastructure/db/repositories/users.ts";
import * as schema from "../infrastructure/db/schema.ts";
import { runEventFlows } from "./run-event-flows.ts";

const TEST_DB = process.env.TEST_DATABASE_URL;
const suite = TEST_DB ? describe : describe.skip;

const EMPTY_QUERY = { combinator: "and" as const, filters: [], sorts: [] };

suite("runEventFlows", () => {
  let sql: Sql;
  let db: Db;
  const sent: { userId: string; text: string }[] = [];
  const notifier: NotificationProvider = {
    send: async (target, message) => {
      sent.push({ userId: target.lineUserId ?? "", text: message.text });
    },
  };

  beforeAll(async () => {
    sql = postgres(TEST_DB!, { max: 1 });
    db = drizzle(sql, { schema });
    await migrate(db, { migrationsFolder: join(import.meta.dir, "../../drizzle") });
  });
  afterAll(async () => {
    await sql?.end();
  });

  it("trigger_user: 友だち追加で本人にメッセージ送信＋ログ(event)", async () => {
    const tpl = await templatesRepo.createTemplate(db, {
      name: "ウェルカム",
      allUsers: false,
      query: EMPTY_QUERY,
      steps: [{ id: "s1", type: "send", text: "はじめまして！" }],
    });
    await triggersRepo.createTrigger(db, {
      templateId: tpl.id,
      eventType: "user.follow",
      audienceMode: "trigger_user",
    });
    const { userId } = await findOrCreateByLineUserId(db, "Uevt_follow");

    sent.length = 0;
    const summary = await runEventFlows(
      { db, notificationProvider: notifier },
      { eventType: "user.follow", userId },
    );
    expect(summary.flowsRun).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).toContain("はじめまして");

    const logs = await flowRunLogsRepo.listFlowRunLogs(db, { templateId: tpl.id });
    expect(logs[0]?.trigger).toBe("event");
    expect(logs[0]?.eventType).toBe("user.follow");
    expect(logs[0]?.audienceCount).toBe(1);
  });

  it("school_subscribers: 購読者だけに実行（非購読者には送らない）", async () => {
    const school = await createSchool(db, { name: "連動校", prefecture: "兵庫県" });
    const sub = await findOrCreateByLineUserId(db, "Uevt_sub");
    const other = await findOrCreateByLineUserId(db, "Uevt_other");
    await upsertSubscription(db, { userId: sub.userId, schoolId: school.id });

    const tpl = await templatesRepo.createTemplate(db, {
      name: "休校連絡フォロー",
      allUsers: false,
      query: EMPTY_QUERY,
      steps: [{ id: "s1", type: "send", text: "本日の対応について" }],
    });
    await triggersRepo.createTrigger(db, {
      templateId: tpl.id,
      eventType: "judgment.closure",
      audienceMode: "school_subscribers",
    });

    sent.length = 0;
    const summary = await runEventFlows(
      { db, notificationProvider: notifier },
      { eventType: "judgment.closure", schoolId: school.id },
    );
    expect(summary.flowsRun).toBe(1);
    // 購読者(sub)には送るが other には送らない → 送信は1件
    expect(sent).toHaveLength(1);
    expect(other.userId).not.toBe(sub.userId);
  });

  it("必要な文脈が無いイベント（userId 無しの trigger_user）は実行しない", async () => {
    const tpl = await templatesRepo.createTemplate(db, {
      name: "noop",
      allUsers: false,
      query: EMPTY_QUERY,
      steps: [{ id: "s1", type: "send", text: "x" }],
    });
    await triggersRepo.createTrigger(db, {
      templateId: tpl.id,
      eventType: "school.subscribe",
      audienceMode: "trigger_user",
    });
    sent.length = 0;
    const summary = await runEventFlows(
      { db, notificationProvider: notifier },
      { eventType: "school.subscribe", schoolId: "00000000-0000-0000-0000-000000000000" }, // userId 無し
    );
    expect(summary.flowsRun).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("addFlag ステップ: trigger_user 本人にフラグ付与", async () => {
    await flagsRepo.createDef(db, { name: "welcomed" });
    const tpl = await templatesRepo.createTemplate(db, {
      name: "フラグ付与",
      allUsers: false,
      query: EMPTY_QUERY,
      steps: [{ id: "s1", type: "addFlag", flag: "welcomed" }],
    });
    await triggersRepo.createTrigger(db, {
      templateId: tpl.id,
      eventType: "user.follow",
      audienceMode: "trigger_user",
    });
    const { userId } = await findOrCreateByLineUserId(db, "Uevt_flag");
    await runEventFlows({ db, notificationProvider: notifier }, { eventType: "user.follow", userId });
    const flags = await flagsRepo.listByUsers(db, [userId]);
    expect(flags.get(userId) ?? []).toContain("welcomed");
  });
});
