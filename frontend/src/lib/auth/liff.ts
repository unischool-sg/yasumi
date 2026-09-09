import liff from "@line/liff";
import type { AuthProvider } from "./types.ts";

let initialized = false;

/**
 * LIFF（LINE ミニアプリ）版の認証プロバイダ。
 * LIFF を初期化し、未ログインならログインへ誘導する（PRD §10.1, §21）。VITE_LIFF_ID が必要。
 * サーバー検証用の ID トークンのみ渡す（フロントは lineUserId を信用させない / §21）。
 */
export const liffAuthProvider: AuthProvider = {
  async init(): Promise<void> {
    if (initialized) return;
    const liffId = import.meta.env.VITE_LIFF_ID;
    if (!liffId) throw new Error("VITE_LIFF_ID が設定されていません");
    await liff.init({ liffId });
    if (!liff.isLoggedIn()) {
      liff.login();
      // login() はリダイレクトするため、以降は実行されない
      return;
    }
    initialized = true;
  },
  getToken(): string | null {
    return liff.getIDToken();
  },
};
