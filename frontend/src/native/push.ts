import { Capacitor } from "@capacitor/core";
import type { ApiClient } from "../api/client.ts";

/**
 * ネイティブ(Capacitor)実行時のみ、FCM デバイストークンを取得して backend に登録する。
 * これで判定パイプラインが LINE 課金プッシュではなく無料の FCM プッシュを送れる（Part B/C）。
 * web/LIFF では何もしない（no-op）。
 */
export async function registerPushToken(api: ApiClient): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    // プラグインはネイティブ実行時のみ動的 import（web バンドルに載せない）。
    const { FirebaseMessaging } = await import("@capacitor-firebase/messaging");
    const perm = await FirebaseMessaging.requestPermissions();
    if (perm.receive !== "granted") return;
    const { token } = await FirebaseMessaging.getToken();
    if (!token) return;
    const platform = Capacitor.getPlatform() === "ios" ? "ios" : "android";
    await api.registerDeviceToken({ token, platform });
  } catch (e) {
    // 権限拒否やプラグイン未設定は致命的でない（通知が届かないだけ）ので握りつぶす。
    console.warn("[push] FCM トークン登録に失敗:", e);
  }
}
