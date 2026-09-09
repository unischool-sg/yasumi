import { describe, expect, it } from "bun:test";
import { FcmNotificationProvider } from "./fcm-notification-provider.ts";

const creds = { projectId: "proj-1", clientEmail: "svc@proj-1.iam", privateKey: "unused-in-test" };

describe("FcmNotificationProvider", () => {
  it("各デバイストークンへ FCM v1 の URL/本文で送信する", async () => {
    const calls: { url: string; body: unknown; auth: string | undefined }[] = [];
    const provider = new FcmNotificationProvider({
      credentials: creds,
      getAccessToken: async () => "access-123",
      fetchFn: async (url, init) => {
        calls.push({
          url,
          body: JSON.parse(String(init.body)),
          auth: (init.headers as Record<string, string>)?.authorization,
        });
        return new Response(null, { status: 200 });
      },
    });

    await provider.send({ deviceTokens: ["tok-a", "tok-b"] }, { text: "午前休です" });

    expect(calls.length).toBe(2);
    expect(calls[0]!.url).toBe("https://fcm.googleapis.com/v1/projects/proj-1/messages:send");
    expect(calls[0]!.auth).toBe("Bearer access-123");
    expect(calls[0]!.body).toEqual({
      message: { token: "tok-a", notification: { title: "やすみ？", body: "午前休です" } },
    });
    expect((calls[1]!.body as { message: { token: string } }).message.token).toBe("tok-b");
  });

  it("デバイストークンが空なら送信しない", async () => {
    let called = false;
    const provider = new FcmNotificationProvider({
      credentials: creds,
      getAccessToken: async () => "access-123",
      fetchFn: async () => {
        called = true;
        return new Response(null, { status: 200 });
      },
    });
    await provider.send({ deviceTokens: [] }, { text: "x" });
    expect(called).toBe(false);
  });

  it("全トークンが失敗したら throw、一部成功なら resolve", async () => {
    const allFail = new FcmNotificationProvider({
      credentials: creds,
      getAccessToken: async () => "t",
      fetchFn: async () => new Response(null, { status: 404 }),
    });
    await expect(allFail.send({ deviceTokens: ["a", "b"] }, { text: "x" })).rejects.toThrow();

    let n = 0;
    const partial = new FcmNotificationProvider({
      credentials: creds,
      getAccessToken: async () => "t",
      fetchFn: async () => new Response(null, { status: n++ === 0 ? 200 : 500 }),
    });
    await expect(partial.send({ deviceTokens: ["ok", "bad"] }, { text: "x" })).resolves.toBeUndefined();
  });
});
