import { createHmac } from "node:crypto";
import { describe, expect, it } from "bun:test";
import { createApp } from "./api/app.ts";
import type { Db } from "./infrastructure/db/client.ts";

// /health と Webhook は DB 非依存。ダミー依存で app を組み立てて確認する。
const SECRET = "test-secret";
const app = createApp({
  db: {} as Db,
  verifyIdToken: async () => ({ lineUserId: "dummy" }),
  lineChannelSecret: SECRET,
});

describe("GET /health", () => {
  it("returns 200 with status ok", async () => {
    const res = await app.fetch(new Request("http://localhost/health"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});

describe("POST /api/webhooks/line", () => {
  const body = '{"events":[]}';
  const req = (sig?: string) =>
    app.fetch(
      new Request("http://localhost/api/webhooks/line", {
        method: "POST",
        headers: sig ? { "x-line-signature": sig } : {},
        body,
      }),
    );

  it("正しい署名 → 200", async () => {
    const sig = createHmac("sha256", SECRET).update(body).digest("base64");
    const res = await req(sig);
    expect(res.status).toBe(200);
  });

  it("署名なし/不正 → 401", async () => {
    expect((await req()).status).toBe(401);
    expect((await req("bogus")).status).toBe(401);
  });
});
