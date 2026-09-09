import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import type { AuthProvider } from "./types.ts";

/**
 * ネイティブ(Capacitor)版の認証プロバイダ。
 * LIFF と同じ LINE Login チャネルで OAuth(PKCE) ログインし、認可コードを backend で
 * ID トークンに交換する（channel secret は端末に置かない）。得た ID トークンは既存の
 * backend 検証（client_id=LIFF_CHANNEL_ID）でそのまま通る。
 */
const AUTHORIZE_URL = "https://access.line.me/oauth2/v2.1/authorize";
const REDIRECT_URI = "yasumi://auth";
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

let idToken: string | null = null;

/** テスト/手動注入用。 */
export function setNativeIdToken(token: string | null): void {
  idToken = token;
}

function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomString(byteLen = 32): string {
  const a = new Uint8Array(byteLen);
  crypto.getRandomValues(a);
  return base64url(a);
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

/** yasumi://auth?code=...&state=... の到来を待つ。 */
function waitForCallback(expectedState: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const sub = App.addListener("appUrlOpen", async ({ url }) => {
      if (!url.startsWith(REDIRECT_URI)) return;
      const q = new URL(url).searchParams;
      (await sub).remove();
      await Browser.close().catch(() => {});
      if (q.get("state") !== expectedState) return reject(new Error("state 不一致"));
      const code = q.get("code");
      if (!code) return reject(new Error(q.get("error") ?? "認可コードがありません"));
      resolve(code);
    });
  });
}

export const nativeAuthProvider: AuthProvider = {
  async init(): Promise<void> {
    if (idToken) return;
    const channelId = import.meta.env.VITE_LIFF_ID;
    if (!channelId) throw new Error("VITE_LIFF_ID（LINE Login チャネルID）が未設定です");

    const state = randomString();
    const verifier = randomString();
    const challenge = await pkceChallenge(verifier);

    const authorizeUrl =
      `${AUTHORIZE_URL}?response_type=code&client_id=${encodeURIComponent(channelId)}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&state=${encodeURIComponent(state)}` +
      `&scope=${encodeURIComponent("openid profile")}` +
      `&code_challenge=${encodeURIComponent(challenge)}&code_challenge_method=S256`;

    const codePromise = waitForCallback(state);
    await Browser.open({ url: authorizeUrl });
    const code = await codePromise;

    // 認可コード → ID トークン（backend が channel secret を保持して交換）
    const res = await fetch(`${API_BASE}/api/auth/line/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, codeVerifier: verifier, redirectUri: REDIRECT_URI }),
    });
    if (!res.ok) throw new Error(`LINE ログインに失敗しました (HTTP ${res.status})`);
    const data = (await res.json()) as { idToken?: string };
    if (!data.idToken) throw new Error("ID トークンを取得できませんでした");
    idToken = data.idToken;
  },
  getToken(): string | null {
    return idToken;
  },
};
