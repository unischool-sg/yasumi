import { describe, expect, it } from "bun:test";
import { exchangeLineCode } from "./line-login.ts";

describe("exchangeLineCode", () => {
  it("認可コードを LINE token endpoint に渡し id_token を返す", async () => {
    let captured: { url: string; body: string } | null = null;
    const { idToken } = await exchangeLineCode(
      {
        code: "authcode-1",
        codeVerifier: "verifier-1",
        redirectUri: "yasumi://auth",
        channelId: "2011524231",
        channelSecret: "secret-xyz",
      },
      {
        fetchFn: async (url, init) => {
          captured = { url, body: String(init.body) };
          return new Response(JSON.stringify({ id_token: "id-token-abc" }), { status: 200 });
        },
      },
    );

    expect(idToken).toBe("id-token-abc");
    expect(captured!.url).toBe("https://api.line.me/oauth2/v2.1/token");
    const params = new URLSearchParams(captured!.body);
    expect(params.get("grant_type")).toBe("authorization_code");
    expect(params.get("code")).toBe("authcode-1");
    expect(params.get("code_verifier")).toBe("verifier-1");
    expect(params.get("client_id")).toBe("2011524231");
    expect(params.get("client_secret")).toBe("secret-xyz");
    expect(params.get("redirect_uri")).toBe("yasumi://auth");
  });

  it("id_token が無ければ throw", async () => {
    await expect(
      exchangeLineCode(
        { code: "c", codeVerifier: "v", redirectUri: "r", channelId: "i", channelSecret: "s" },
        { fetchFn: async () => new Response(JSON.stringify({ access_token: "x" }), { status: 200 }) },
      ),
    ).rejects.toThrow();
  });

  it("HTTP エラーで throw", async () => {
    await expect(
      exchangeLineCode(
        { code: "c", codeVerifier: "v", redirectUri: "r", channelId: "i", channelSecret: "s" },
        { fetchFn: async () => new Response(null, { status: 400 }) },
      ),
    ).rejects.toThrow();
  });
});
