import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import type { Sql } from "postgres";
import type { Db } from "../infrastructure/db/client.ts";
import * as flowRunLogsRepo from "../infrastructure/db/repositories/flow-run-logs.ts";
import type { Storage } from "../infrastructure/storage/s3.ts";
import * as schema from "../infrastructure/db/schema.ts";
import { runFlowLogRetention } from "./flow-log-retention.ts";

const TEST_DB = process.env.TEST_DATABASE_URL;
const suite = TEST_DB ? describe : describe.skip;

function fakeStorage() {
  const puts: { key: string; body: string }[] = [];
  const storage: Storage = {
    put: async (key, data) => {
      puts.push({ key, body: new TextDecoder().decode(data as Uint8Array) });
    },
    get: async () => null,
    delete: async () => {},
  };
  return { storage, puts };
}

suite("runFlowLogRetention", () => {
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

  it("storage 未設定なら削除せずスキップ", async () => {
    await flowRunLogsRepo.recordFlowRun(db, {
      templateId: null,
      templateName: "保持テスト",
      trigger: "manual",
      audienceCount: 3,
      results: [{ type: "send", sent: 3, total: 3 }],
      status: "success",
    });
    // now を未来にして全ログを cutoff 超に。ただし storage 無しなので削除されない。
    const res = await runFlowLogRetention({ db, now: () => new Date("2099-01-01T00:00:00Z") });
    expect(res.skipped).toBe("no-storage");
    expect(res.deleted).toBe(0);
    const remaining = await flowRunLogsRepo.listFlowRunLogs(db);
    expect(remaining.length).toBeGreaterThan(0);
  });

  it("30日超は S3 に JSON 退避してから削除する", async () => {
    const { storage, puts } = fakeStorage();
    const before = await flowRunLogsRepo.listFlowRunLogs(db);
    expect(before.length).toBeGreaterThan(0);

    const res = await runFlowLogRetention({ db, storage, now: () => new Date("2099-01-01T00:00:00Z") });
    expect(res.archived).toBe(before.length);
    expect(res.deleted).toBe(before.length);

    // S3 に1オブジェクト、JSON にログが含まれる
    expect(puts.length).toBe(1);
    expect(puts[0]?.key.startsWith("flow-logs/expired-")).toBe(true);
    const archived = JSON.parse(puts[0]!.body);
    expect(archived.count).toBe(before.length);
    expect(archived.logs.length).toBe(before.length);

    // DB からは削除済み
    const after = await flowRunLogsRepo.listFlowRunLogs(db);
    expect(after.length).toBe(0);
  });

  it("退避対象がなければ何もしない", async () => {
    const { storage, puts } = fakeStorage();
    const res = await runFlowLogRetention({ db, storage, now: () => new Date("2000-01-01T00:00:00Z") });
    expect(res.archived).toBe(0);
    expect(res.deleted).toBe(0);
    expect(puts.length).toBe(0);
  });
});
