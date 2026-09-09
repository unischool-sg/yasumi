import type { AuthProvider } from "./types.ts";

/**
 * ネイティブ(Capacitor)版の認証プロバイダ。
 * Part B で LINE ログイン（OAuth + カスタム URL スキーム yasumi://）を実装し、
 * 取得した ID トークンを既存の backend 検証（LIFF_CHANNEL）で使い回す。
 *
 * 現状は未実装スタブ。native ビルドの土台としてインターフェースだけ用意している。
 */
let idToken: string | null = null;

/** ネイティブ層(LINE ログイン成功時)から ID トークンを注入する（Part B で使用）。 */
export function setNativeIdToken(token: string | null): void {
  idToken = token;
}

export const nativeAuthProvider: AuthProvider = {
  async init(): Promise<void> {
    // TODO(Part B): LINE ログイン(native OAuth)を実装し idToken を設定する。
    if (!idToken) {
      throw new Error("native の LINE ログインは未実装です（Part B）");
    }
  },
  getToken(): string | null {
    return idToken;
  },
};
