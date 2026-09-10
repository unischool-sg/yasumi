import type { ApiClient } from "../api/client.ts";

/**
 * ネイティブ層(Capacitor / native ワークスペース)が実行時に注入するブリッジ。
 * frontend 本体は Capacitor/firebase に依存しない（web デプロイを軽く保つ / セキュリティproxy対策）。
 * native ビルド時に window.yasumiNative へ実装が注入される。
 */
export interface NativeBridge {
  /** FCM デバイストークンを取得して backend に登録する。 */
  registerPush?(api: ApiClient): Promise<void>;
  /** LINE ログイン(OAuth)を行い ID トークンを返す。未ログインなら null。 */
  lineLogin?(): Promise<string | null>;
}

declare global {
  // eslint-disable-next-line no-var
  var yasumiNative: NativeBridge | undefined;
}

export function getNativeBridge(): NativeBridge | undefined {
  return globalThis.yasumiNative;
}
