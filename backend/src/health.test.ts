import { describe, expect, it } from "bun:test";
import { createApp } from "./api/app.ts";
import type { Db } from "./infrastructure/db/client.ts";

// /health は無認証・DB 非依存。ダミー依存で app を組み立てて確認する。
const app = createApp({
  db: {} as Db,
  verifyIdToken: async () => ({ lineUserId: "dummy" }),
});

describe("GET /health", () => {
  it("returns 200 with status ok", async () => {
    const res = await app.fetch(new Request("http://localhost/health"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});
