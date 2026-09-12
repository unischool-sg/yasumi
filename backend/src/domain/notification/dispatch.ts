import type { Db } from "../../infrastructure/db/client.ts";
import * as deviceTokensRepo from "../../infrastructure/db/repositories/device-tokens.ts";
import * as usersRepo from "../../infrastructure/db/repositories/users.ts";
import type { NotificationProvider } from "./provider.ts";

export interface NotifyDeps {
  db: Db;
  /** LINE プッシュ（デバイストークン未登録ユーザー向けフォールバック）。 */
  notificationProvider?: NotificationProvider;
  /** FCM プッシュ（デバイストークン登録済みユーザー向け・無料・優先）。 */
  pushProvider?: NotificationProvider;
}

/**
 * 内部ユーザーに単発の通知を1通送る。デバイストークンがあれば FCM(無料)、無ければ LINE。
 * 送信失敗やプロバイダ未設定でも例外は投げず false を返す（呼び出し側の主処理を止めない）。
 */
export async function notifyUser(
  deps: NotifyDeps,
  userId: string,
  text: string,
  action?: { label: string; url: string },
): Promise<boolean> {
  try {
    const deviceTokens = await deviceTokensRepo.listTokensByUser(deps.db, userId);
    if (deviceTokens.length > 0 && deps.pushProvider) {
      // FCM はボタン非対応のため、URL は本文末尾に付与してフォールバック。
      await deps.pushProvider.send({ deviceTokens }, { text: action ? `${text}\n${action.url}` : text });
      return true;
    }
    const lineUserId = await usersRepo.getLineUserId(deps.db, userId);
    if (lineUserId && deps.notificationProvider) {
      // LINE は action があればボタン付き Flex で送る。
      await deps.notificationProvider.send({ lineUserId }, { text, ...(action ? { action } : {}) });
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
