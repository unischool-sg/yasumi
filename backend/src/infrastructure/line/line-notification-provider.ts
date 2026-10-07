import {
  type NotificationMessage,
  type NotificationProvider,
  type NotificationTarget,
  PushDeliveryError,
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
    // action があれば本文＋ボタンの Flex バブル、無ければテキスト。
    const line = message.action
      ? {
          type: "flex",
          altText: message.text.slice(0, 400),
          contents: {
            type: "bubble",
            body: {
              type: "box",
              layout: "vertical",
              contents: [{ type: "text", text: message.text, wrap: true, size: "sm" }],
            },
            footer: {
              type: "box",
              layout: "vertical",
              contents: [
                {
                  type: "button",
                  style: "primary",
                  height: "sm",
                  action: { type: "uri", label: message.action.label.slice(0, 20), uri: message.action.url },
                },
              ],
            },
          },
        }
      : { type: "text", text: message.text };
    const res = await this.fetchFn(LINE_PUSH_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.accessToken}`,
      },
      body: JSON.stringify({ to: target.lineUserId, messages: [line] }),
    });
    if (!res.ok) {
      // 原因究明のため LINE API のレスポンス本文（message/details）を取り込む。
      let body = "";
      try {
        body = (await res.text()).slice(0, 1000);
      } catch {
        // 本文が読めなくても status だけで続行。
      }
      // 400 は多くの場合「未友だち／ブロック」。呼び出し側が区別できるよう status を載せる。
      throw new PushDeliveryError(res.status, `LINE push failed (HTTP ${res.status})${body ? `: ${body}` : ""}`);
    }
  }
}
