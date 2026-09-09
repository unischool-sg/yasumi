/**
 * FCM HTTP v1 用の OAuth2 アクセストークン取得（サービスアカウントの JWT グラント）。
 * サービスアカウント秘密鍵で RS256 署名した JWT を Google のトークンエンドポイントに渡し、
 * `firebase.messaging` スコープのアクセストークンを得る。約1時間キャッシュする。
 */

export interface FcmCredentials {
  projectId: string;
  clientEmail: string;
  /** PEM 形式(PKCS#8)の秘密鍵。改行は実改行 or \n エスケープどちらでも可。 */
  privateKey: string;
}

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlJson(obj: unknown): string {
  return base64url(new TextEncoder().encode(JSON.stringify(obj)));
}

/** PEM(PKCS#8) を ArrayBuffer に変換。 */
function pemToPkcs8(pem: string): ArrayBuffer {
  const normalized = pem.replace(/\\n/g, "\n");
  const body = normalized
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const bin = atob(body);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

async function signJwt(creds: FcmCredentials, nowSec: number): Promise<string> {
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: creds.clientEmail,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: nowSec,
    exp: nowSec + 3600,
  };
  const unsigned = `${base64urlJson(header)}.${base64urlJson(claims)}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(creds.privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${base64url(new Uint8Array(sig))}`;
}

/**
 * アクセストークン取得関数を作る。取得結果は失効の1分前までキャッシュ。
 * fetchFn / now は差し替え可能（テスト用）。
 */
export function createFcmAccessTokenGetter(
  creds: FcmCredentials,
  opts: { fetchFn?: FetchFn; now?: () => number } = {},
): () => Promise<string> {
  const fetchFn = opts.fetchFn ?? ((url, init) => fetch(url, init));
  const now = opts.now ?? (() => Date.now());
  let cached: { token: string; expiresAtMs: number } | null = null;

  return async () => {
    const nowMs = now();
    if (cached && nowMs < cached.expiresAtMs) return cached.token;

    const assertion = await signJwt(creds, Math.floor(nowMs / 1000));
    const res = await fetchFn(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }).toString(),
    });
    if (!res.ok) throw new Error(`FCM token exchange failed (HTTP ${res.status})`);
    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) throw new Error("FCM token exchange: no access_token");
    const ttlMs = (data.expires_in ?? 3600) * 1000;
    cached = { token: data.access_token, expiresAtMs: nowMs + ttlMs - 60_000 };
    return cached.token;
  };
}
