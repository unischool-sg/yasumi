/**
 * ネイティブ(Capacitor)専用のブリッジ実装。frontend が呼ぶ window.yasumiNative を提供する。
 * frontend 本体は Capacitor/firebase に依存させない（web デプロイ＆セキュリティproxy対策）ため、
 * Capacitor プラグインを使う処理はここ（native ワークスペース）に隔離する。
 *
 * ビルド: native ビルド時にこのファイルを bundle し、Capacitor アプリの webDir(index.html) に
 * <script type="module"> で読み込ませる（native/README 参照）。frontend より先に実行されるよう配置。
 *
 * 設定値（native ビルドの env で注入 / esbuild --define 等）:
 *   LINE_LOGIN_CHANNEL_ID … LIFF と同じ LINE Login チャネルID
 *   API_BASE              … 公開API のベースURL（https://yasumi-api.unischool.jp）
 */
import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";

declare const LINE_LOGIN_CHANNEL_ID: string;
declare const API_BASE: string;

const AUTHORIZE_URL = "https://access.line.me/oauth2/v2.1/authorize";
const REDIRECT_URI = "yasumi://auth";

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
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(d));
}

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

async function lineLogin(): Promise<string | null> {
  const state = randomString();
  const verifier = randomString();
  const challenge = await pkceChallenge(verifier);
  const authorizeUrl =
    `${AUTHORIZE_URL}?response_type=code&client_id=${encodeURIComponent(LINE_LOGIN_CHANNEL_ID)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&state=${encodeURIComponent(state)}` +
    `&scope=${encodeURIComponent("openid profile")}` +
    `&code_challenge=${encodeURIComponent(challenge)}&code_challenge_method=S256`;

  const codePromise = waitForCallback(state);
  await Browser.open({ url: authorizeUrl });
  const code = await codePromise;

  const res = await fetch(`${API_BASE}/api/auth/line/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, codeVerifier: verifier, redirectUri: REDIRECT_URI }),
  });
  if (!res.ok) throw new Error(`LINE ログインに失敗しました (HTTP ${res.status})`);
  const data = (await res.json()) as { idToken?: string };
  return data.idToken ?? null;
}

async function registerPush(api: { registerDeviceToken(i: { token: string; platform: "ios" | "android" | "web" }): Promise<void> }): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  const { FirebaseMessaging } = await import("@capacitor-firebase/messaging");
  const perm = await FirebaseMessaging.requestPermissions();
  if (perm.receive !== "granted") return;
  const { token } = await FirebaseMessaging.getToken();
  if (!token) return;
  const platform = Capacitor.getPlatform() === "ios" ? "ios" : "android";
  await api.registerDeviceToken({ token, platform });
}

// frontend が参照するブリッジを公開。
(globalThis as unknown as { yasumiNative: unknown }).yasumiNative = { lineLogin, registerPush };
