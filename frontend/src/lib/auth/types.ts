/**
 * 認証プロバイダの抽象。LIFF / ネイティブ(LINE ログイン) を差し替え可能にする。
 * アプリは「サーバー検証用の Bearer トークン(LINE ID トークン)をどう得るか」だけを知ればよい。
 */
export interface AuthProvider {
  /** 初期化。未ログインならログインへ誘導（副作用でリダイレクトする場合あり）。 */
  init(): Promise<void>;
  /** サーバー検証用の ID トークン。未取得なら null。 */
  getToken(): string | null;
}
