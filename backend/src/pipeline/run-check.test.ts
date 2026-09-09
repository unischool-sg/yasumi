import { join } from "node:path";
import type { Warning } from "@yasumi/shared";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import type { Sql } from "postgres";
import type { NotificationProvider } from "../domain/notification/provider.ts";
import type { WarningProvider } from "../domain/warning/provider.ts";
import type { Db } from "../infrastructure/db/client.ts";
import * as cfg from "../infrastructure/db/repositories/school-config.ts";
import { createRule } from "../infrastructure/db/repositories/rules.ts";
import { createSchool } from "../infrastructure/db/repositories/schools.ts";
import * as schema from "../infrastructure/db/schema.ts";
import { upsertSubscription } from "../infrastructure/db/repositories/subscriptions.ts";
import { upsertDeviceToken } from "../infrastructure/db/repositories/device-tokens.ts";
import { findOrCreateByLineUserId } from "../infrastructure/db/repositories/users.ts";
import { runCheck } from "./run-check.ts";

const TEST_DB = process.env.TEST_DATABASE_URL;
const suite = TEST_DB ? describe : describe.skip;

const SANDA = "2834100";
const AT_0800 = new Date("2026-09-09T08:00:00+09:00");
const AT_1000 = new Date("2026-09-09T10:00:00+09:00");

const activeStorm: Warning[] = [
  { areaCode: SANDA, areaName: "三田市", warningType: "暴風警報", status: "active", issuedAt: AT_0800 },
];

function providerReturning(warnings: Warning[]): WarningProvider {
  return { getActiveWarnings: async () => warnings };
}
const providerFailing: WarningProvider = {
  getActiveWarnings: async () => {
    throw new Error("JMA down");
  },
};

suite("runCheck pipeline", () => {
  let sql: Sql;
  let db: Db;
  const sent: { lineUserId: string; text: string }[] = [];
  const notifier: NotificationProvider = {
    send: async (target, message) => {
      sent.push({ lineUserId: target.lineUserId ?? "", text: message.text });
    },
  };
  let schoolId: string;

  beforeAll(async () => {
    sql = postgres(TEST_DB!, { max: 1 });
    db = drizzle(sql, { schema });
    await migrate(db, { migrationsFolder: join(import.meta.dir, "../../drizzle") });

    const school = await createSchool(db, { name: "パイプライン校", prefecture: "兵庫県", city: "三田市" });
    schoolId = school.id;
    await cfg.setAreaCodes(db, schoolId, [SANDA]);
    await cfg.setWarningTypes(db, schoolId, ["暴風警報"]);
    await createRule(db, { schoolId, checkTime: "08:00", result: "AM_OFF" });
    await createRule(db, { schoolId, checkTime: "10:00", result: "FULL_OFF" });

    const { userId } = await findOrCreateByLineUserId(db, "Ucron_pipeline");
    await upsertSubscription(db, { userId, schoolId });
  });

  afterAll(async () => {
    await sql?.end();
  });

  it("08:00 暴風警報 active → AM_OFF 判定・通知送信", async () => {
    sent.length = 0;
    const summary = await runCheck(
      { db, warningProvider: providerReturning(activeStorm), notificationProvider: notifier, now: () => AT_0800 },
      { triggeredAt: AT_0800 },
    );
    expect(summary.checksCreated).toBe(1);
    expect(summary.notificationsSent).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).toContain("午前休");
  });

  it("同一時刻の再実行 → 冪等（判定・通知とも増えない §35/§36）", async () => {
    sent.length = 0;
    const summary = await runCheck(
      { db, warningProvider: providerReturning(activeStorm), notificationProvider: notifier, now: () => AT_0800 },
      { triggeredAt: AT_0800 },
    );
    expect(summary.checksCreated).toBe(0);
    expect(summary.notificationsSent).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("10:00 警報なし → NORMAL・通知なし", async () => {
    sent.length = 0;
    const summary = await runCheck(
      { db, warningProvider: providerReturning([]), notificationProvider: notifier, now: () => AT_1000 },
      { triggeredAt: AT_1000 },
    );
    expect(summary.checksCreated).toBe(1);
    expect(summary.notificationsSent).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("気象庁取得失敗 → UNKNOWN 判定・通知（§51）", async () => {
    // 別学校/別時刻で検証（08:30）
    const s = await createSchool(db, { name: "UNKNOWN校", prefecture: "兵庫県" });
    await cfg.setAreaCodes(db, s.id, [SANDA]);
    await cfg.setWarningTypes(db, s.id, ["暴風警報"]);
    await createRule(db, { schoolId: s.id, checkTime: "08:30", result: "AM_OFF" });
    const { userId } = await findOrCreateByLineUserId(db, "Ucron_unknown");
    await upsertSubscription(db, { userId, schoolId: s.id });

    sent.length = 0;
    const at0830 = new Date("2026-09-09T08:30:00+09:00");
    const summary = await runCheck(
      { db, warningProvider: providerFailing, notificationProvider: notifier, now: () => at0830 },
      { triggeredAt: at0830 },
    );
    expect(summary.fetchFailed).toBe(true);
    expect(summary.notificationsSent).toBe(1);
    expect(sent[0]?.text).toContain("判定できませんでした");
  });

  it("デバイストークン登録済み → FCM(pushProvider)へ送信し LINE には送らない", async () => {
    const s = await createSchool(db, { name: "FCM校", prefecture: "兵庫県" });
    await cfg.setAreaCodes(db, s.id, [SANDA]);
    await cfg.setWarningTypes(db, s.id, ["暴風警報"]);
    await createRule(db, { schoolId: s.id, checkTime: "09:00", result: "AM_OFF" });
    const { userId } = await findOrCreateByLineUserId(db, "Ucron_fcm");
    await upsertSubscription(db, { userId, schoolId: s.id });
    await upsertDeviceToken(db, { userId, platform: "android", token: "devtok-1" });

    const pushSent: { deviceTokens: string[]; text: string }[] = [];
    const pushProvider: NotificationProvider = {
      send: async (target, message) => {
        pushSent.push({ deviceTokens: target.deviceTokens ?? [], text: message.text });
      },
    };

    sent.length = 0;
    const at0900 = new Date("2026-09-09T09:00:00+09:00");
    const summary = await runCheck(
      {
        db,
        warningProvider: providerReturning(activeStorm),
        notificationProvider: notifier,
        pushProvider,
        now: () => at0900,
      },
      { triggeredAt: at0900 },
    );

    expect(summary.notificationsSent).toBe(1);
    expect(pushSent).toHaveLength(1);
    expect(pushSent[0]?.deviceTokens).toEqual(["devtok-1"]);
    expect(sent).toHaveLength(0); // LINE には送らない（FCM 優先）
  });
});
