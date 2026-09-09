import { createHmac } from "node:crypto";
import { describe, expect, it } from "bun:test";
import { LineNotificationProvider } from "./line-notification-provider.ts";
import { verifySignature } from "./webhook.ts";

describe("LineNotificationProvider", () => {
  it("push ボディとヘッダを正しく送る", async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    const provider = new LineNotificationProvider({
      accessToken: "TOKEN",
      fetchFn: async (url, init) => {
        captured = { url, init };
        return new Response("{}", { status: 200 });
      },
    });
    await provider.send({ lineUserId: "U123" }, { text: "hello" });
    expect(captured?.url).toContain("/message/push");
    expect((captured?.init.headers as Record<string, string>).authorization).toBe("Bearer TOKEN");
    const body = JSON.parse(captured?.init.body as string);
    expect(body.to).toBe("U123");
    expect(body.messages[0].text).toBe("hello");
  });

  it("HTTP エラーで例外", async () => {
    const provider = new LineNotificationProvider({
      accessToken: "T",
      fetchFn: async () => new Response("", { status: 400 }),
    });
    await expect(provider.send({ lineUserId: "U" }, { text: "x" })).rejects.toThrow();
  });
});

describe("verifySignature", () => {
  const secret = "channel-secret";
  const body = '{"events":[]}';
  const sig = createHmac("sha256", secret).update(body).digest("base64");

  it("正しい署名 → true", () => {
    expect(verifySignature(body, sig, secret)).toBe(true);
  });
  it("改竄ボディ → false", () => {
    expect(verifySignature('{"events":[1]}', sig, secret)).toBe(false);
  });
  it("署名なし → false", () => {
    expect(verifySignature(body, undefined, secret)).toBe(false);
  });
});
