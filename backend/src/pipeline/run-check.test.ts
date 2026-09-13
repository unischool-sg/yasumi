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
  return { getActiveWarnings: async () => ({ warnings, failedPrefCodes: [] }) };
}
// 兵庫(280000)の取得に失敗した状態を再現（部分失敗）。
const providerFailing: WarningProvider = {
  getActiveWarnings: async () => ({ warnings: [], failedPrefCodes: ["280000"] }),
};
// provider 自体が例外を投げる異常系（呼び出し側の防御 catch を検証）。
const providerThrowing: WarningProvider = {
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

  it("都道府県の部分失敗 → 失敗県のみ UNKNOWN・成功県は通常判定（§51）", async () => {
    const OSAKA = "2710000";
    // 兵庫の学校（取得失敗する県）
    const hyogo = await createSchool(db, { name: "部分失敗-兵庫校", prefecture: "兵庫県" });
    await cfg.setAreaCodes(db, hyogo.id, [SANDA]);
    await cfg.setWarningTypes(db, hyogo.id, ["暴風警報"]);
    await createRule(db, { schoolId: hyogo.id, checkTime: "08:15", result: "AM_OFF" });
    const hyogoUser = await findOrCreateByLineUserId(db, "Ucron_part_hyogo");
    await upsertSubscription(db, { userId: hyogoUser.userId, schoolId: hyogo.id });
    // 大阪の学校（取得成功・警報あり）
    const osaka = await createSchool(db, { name: "部分失敗-大阪校", prefecture: "大阪府" });
    await cfg.setAreaCodes(db, osaka.id, [OSAKA]);
    await cfg.setWarningTypes(db, osaka.id, ["暴風警報"]);
    await createRule(db, { schoolId: osaka.id, checkTime: "08:15", result: "AM_OFF" });
    const osakaUser = await findOrCreateByLineUserId(db, "Ucron_part_osaka");
    await upsertSubscription(db, { userId: osakaUser.userId, schoolId: osaka.id });

    const at0815 = new Date("2026-09-09T08:15:00+09:00");
    const partialProvider: WarningProvider = {
      getActiveWarnings: async () => ({
        warnings: [
          { areaCode: OSAKA, areaName: "大阪市", warningType: "暴風警報", status: "active", issuedAt: at0815 },
        ],
        failedPrefCodes: ["280000"], // 兵庫のみ失敗
      }),
    };

    sent.length = 0;
    const summary = await runCheck(
      { db, warningProvider: partialProvider, notificationProvider: notifier, now: () => at0815 },
      { triggeredAt: at0815 },
    );

    expect(summary.fetchFailed).toBe(true);
    const hyogoMsg = sent.find((m) => m.text.includes("部分失敗-兵庫校"));
    const osakaMsg = sent.find((m) => m.text.includes("部分失敗-大阪校"));
    // 兵庫は UNKNOWN、大阪は通常判定（AM_OFF）
    expect(hyogoMsg?.text).toContain("判定できませんでした");
    expect(osakaMsg).toBeDefined();
    expect(osakaMsg?.text).not.toContain("判定できませんでした");
  });

  it("provider が例外 → 全対象県を安全側で UNKNOWN 扱い（防御 catch）", async () => {
    const s = await createSchool(db, { name: "例外校", prefecture: "兵庫県" });
    await cfg.setAreaCodes(db, s.id, [SANDA]);
    await cfg.setWarningTypes(db, s.id, ["暴風警報"]);
    await createRule(db, { schoolId: s.id, checkTime: "08:45", result: "AM_OFF" });
    const { userId } = await findOrCreateByLineUserId(db, "Ucron_throw");
    await upsertSubscription(db, { userId, schoolId: s.id });

    sent.length = 0;
    const at0845 = new Date("2026-09-09T08:45:00+09:00");
    const summary = await runCheck(
      { db, warningProvider: providerThrowing, notificationProvider: notifier, now: () => at0845 },
      { triggeredAt: at0845 },
    );
    expect(summary.fetchFailed).toBe(true);
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
