import type {
  NotificationMessage,
  NotificationProvider,
  NotificationTarget,
} from "../../domain/notification/provider.ts";

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";

/**
 * LINE Messaging API で Push 通知する NotificationProvider（PRD §18, §50）。
 */
export class LineNotificationProvider implements NotificationProvider {
  private readonly accessToken: string;
  private readonly fetchFn: FetchFn;

  constructor(options: { accessToken: string; fetchFn?: FetchFn }) {
    this.accessToken = options.accessToken;
    this.fetchFn = options.fetchFn ?? ((url, init) => fetch(url, init));
  }

  async send(target: NotificationTarget, message: NotificationMessage): Promise<void> {
    if (!target.lineUserId) throw new Error("LINE push requires lineUserId");
    const res = await this.fetchFn(LINE_PUSH_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.accessToken}`,
      },
      body: JSON.stringify({
        to: target.lineUserId,
        messages: [{ type: "text", text: message.text }],
      }),
    });
    if (!res.ok) {
      throw new Error(`LINE push failed (HTTP ${res.status})`);
    }
  }
}
