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

/**
 * 公式アカウントの友だち状態を取得する（LIFF のみ）。
 * true=友だち / false=未友だち / null=判定不能（非LIFF・未初期化・API不可）。
 * 未友だちだと LINE プッシュが届かない（送信側が 400）ため、追加導線の出し分けに使う。
 */
export async function getLiffFriendFlag(): Promise<boolean | null> {
  try {
    const fs = await liff.getFriendship();
    return fs.friendFlag;
  } catch {
    return null;
  }
}
