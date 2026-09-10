import { getNativeBridge } from "../../native/bridge.ts";
import type { AuthProvider } from "./types.ts";

/**
 * ネイティブ(Capacitor)版の認証プロバイダ。
 * LINE ログイン(OAuth+PKCE)の実体は native/ ワークスペースが window.yasumiNative.lineLogin として
 * 注入する（Capacitor プラグインを使うため frontend 本体には持ち込まない）。得た ID トークンは
 * 既存の backend 検証（client_id=LIFF_CHANNEL_ID / LIFF と同じ LINE Login チャネル）でそのまま通る。
 */
let idToken: string | null = null;

/** テスト/手動注入用。 */
export function setNativeIdToken(token: string | null): void {
  idToken = token;
}

export const nativeAuthProvider: AuthProvider = {
  async init(): Promise<void> {
    if (idToken) return;
    const bridge = getNativeBridge();
    if (!bridge?.lineLogin) {
      throw new Error("native ブリッジ(LINE ログイン)が見つかりません");
    }
    const token = await bridge.lineLogin();
    if (!token) throw new Error("LINE ログインに失敗しました");
    idToken = token;
  },
  getToken(): string | null {
    return idToken;
  },
};
