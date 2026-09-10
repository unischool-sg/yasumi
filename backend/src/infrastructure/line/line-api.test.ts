import { describe, expect, it } from "bun:test";
import { getLineProfile } from "./line-api.ts";

describe("getLineProfile", () => {
  it("プロフィールを返す", async () => {
    let capturedUrl = "";
    const p = await getLineProfile("token-1", "U123", {
      fetchFn: async (url) => {
        capturedUrl = url;
        return new Response(JSON.stringify({ displayName: "たなか", pictureUrl: "https://x/y.png" }), { status: 200 });
      },
    });
    expect(p?.displayName).toBe("たなか");
    expect(capturedUrl).toContain("/v2/bot/profile/U123");
  });

  it("未友だち/失敗時は null", async () => {
    const p = await getLineProfile("token-1", "U404", { fetchFn: async () => new Response(null, { status: 404 }) });
    expect(p).toBeNull();
  });

  it("access token が空なら null（API を叩かない）", async () => {
    let called = false;
    const p = await getLineProfile("", "U1", {
      fetchFn: async () => {
        called = true;
        return new Response(null, { status: 200 });
      },
    });
    expect(p).toBeNull();
    expect(called).toBe(false);
  });
});
