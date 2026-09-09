import liff from "@line/liff";

let initialized = false;

/**
 * LIFF を初期化し、未ログインならログインへ誘導する（PRD §10.1, §21）。
 * VITE_LIFF_ID が必要。
 */
export async function initLiff(): Promise<void> {
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
}

/** サーバー検証用の ID トークンを取得する（フロントは lineUserId を信用させない / §21）。 */
export function getIdToken(): string | null {
  return liff.getIDToken();
}
