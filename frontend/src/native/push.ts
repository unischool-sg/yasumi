import type { ApiClient } from "../api/client.ts";
import { getNativeBridge } from "./bridge.ts";

/**
 * ネイティブ実行時のみ、native ブリッジ経由で FCM デバイストークンを登録する。
 * web/LIFF ではブリッジが無いので no-op（frontend は Capacitor 非依存）。
 * 実体は native/ ワークスペースが window.yasumiNative.registerPush として注入する。
 */
export async function registerPushToken(api: ApiClient): Promise<void> {
  try {
    await getNativeBridge()?.registerPush?.(api);
  } catch (e) {
    console.warn("[push] FCM トークン登録に失敗:", e);
  }
}
