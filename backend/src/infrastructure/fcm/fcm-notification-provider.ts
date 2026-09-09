import type {
  NotificationMessage,
  NotificationProvider,
  NotificationTarget,
} from "../../domain/notification/provider.ts";
import { type FcmCredentials, createFcmAccessTokenGetter } from "./access-token.ts";

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

const FCM_SEND_URL = (projectId: string) =>
  `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;

const NOTIFICATION_TITLE = "やすみ？";

/**
 * FCM HTTP v1 で無料プッシュ通知する NotificationProvider（ネイティブアプリ/PWA 向け）。
 * target.deviceTokens の各トークンへ送信。iOS は APNs 認証キーを Firebase に載せて FCM 経由で届く。
 */
export class FcmNotificationProvider implements NotificationProvider {
  private readonly projectId: string;
  private readonly fetchFn: FetchFn;
  private readonly getAccessToken: () => Promise<string>;

  constructor(options: {
    credentials: FcmCredentials;
    fetchFn?: FetchFn;
    /** テスト用にアクセストークン取得を差し替え可能。 */
    getAccessToken?: () => Promise<string>;
    now?: () => number;
  }) {
    this.projectId = options.credentials.projectId;
    this.fetchFn = options.fetchFn ?? ((url, init) => fetch(url, init));
    this.getAccessToken =
      options.getAccessToken ??
      createFcmAccessTokenGetter(options.credentials, {
        ...(options.fetchFn ? { fetchFn: options.fetchFn } : {}),
        ...(options.now ? { now: options.now } : {}),
      });
  }

  async send(target: NotificationTarget, message: NotificationMessage): Promise<void> {
    const tokens = target.deviceTokens ?? [];
    if (tokens.length === 0) return;

    const accessToken = await this.getAccessToken();
    let sent = 0;
    let lastError: Error | undefined;

    for (const token of tokens) {
      try {
        const res = await this.fetchFn(FCM_SEND_URL(this.projectId), {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            message: {
              token,
              notification: { title: NOTIFICATION_TITLE, body: message.text },
            },
          }),
        });
        if (res.ok) {
          sent++;
        } else {
          lastError = new Error(`FCM push failed (HTTP ${res.status})`);
        }
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
      }
    }

    // 1件も送れなければ失敗として投げる（呼び出し側でエラー計上）。一部成功なら成功扱い。
    if (sent === 0) throw lastError ?? new Error("FCM push: no tokens delivered");
  }
}
