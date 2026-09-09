# やすみ？ LINE 通知 / Webhook 仕様書

> 本書は [PRD.md](../PRD.md) §18, §19, §20, §50, §52, §54 を具体化した詳細仕様。
> [ROADMAP.md](../ROADMAP.md) の **M6** に対応する。

---

## 1. 目的と責務境界

- 判定結果を LINE Messaging API で Push 通知する。
- 通知処理は抽象化し **LINE 依存にしない**（§50, §62）。
- 誰にいつ通知するか（購読者取得・二重通知防止）は M7 パイプラインの責務。
  M6 は「送る手段」と「文面生成」と「Webhook 受け口」を提供する。

## 2. 通知抽象（PRD §50）

```ts
// domain/notification/provider.ts
export interface NotificationTarget { lineUserId: string; }
export interface NotificationMessage { text: string; }
export interface NotificationProvider {
  send(target: NotificationTarget, message: NotificationMessage): Promise<void>;
}
```

MVP: `LineNotificationProvider`。将来: WebPush / Discord / Email（§60）。

## 3. 通知条件（PRD §19）

```ts
// NORMAL は通知しない。WAIT/AM_OFF/PM_START/FULL_OFF/UNKNOWN は通知。
export function shouldNotify(result: CheckResult): boolean;
```

## 4. 文面生成（純粋関数 / PRD §18, §52）

```ts
// domain/notification/messages.ts
buildNotificationText(input: {
  result: CheckResult;
  schoolName: string;
  checkTime: string;         // "HH:MM"
  matchedWarnings: Warning[];
}): string
```

- AM_OFF: 「🚨 やすみ？判定 … 『午前休』に該当 … 次回判定 …」（§18）
- FULL_OFF: 「🎉 本日は休校です …」（§18）
- UNKNOWN: 「⚠️ 判定できませんでした …」（§52）
- 末尾に「※学校公式の発表ではありません」等の免責（§18, §53）。

## 5. LINE 実装（infrastructure/line）

- `line-notification-provider.ts`: `POST https://api.line.me/v2/bot/message/push`
  - `Authorization: Bearer LINE_CHANNEL_ACCESS_TOKEN`
  - body `{ to: lineUserId, messages: [{ type: "text", text }] }`
  - fetch 注入可能（テスト用）。失敗は例外。
- `webhook.ts`: `verifySignature(rawBody, signature, channelSecret)` … HMAC-SHA256 → base64 比較（§54）。

## 6. Webhook エンドポイント（PRD §37, §54）

- `POST /api/webhooks/line`（**認証不要・署名必須**）。
- 生ボディで署名検証 → 不一致は 401。
- MVP: 友だち追加/メッセージは最小処理（200 応答・ログ）。リッチメニュー等は将来（§20）。
- `createApp` deps に `lineChannelSecret` を追加。auth 前に app 直下でルート登録。

## 7. テスト

- `messages.test.ts`: 各結果種別の文面に必要語句が含まれる／NORMAL 判定は shouldNotify=false。
- `line-notification-provider.test.ts`: 注入 fetch で push ボディ・ヘッダ検証、HTTP エラー時に例外。
- `webhook.test.ts`: 正しい署名で true、改竄で false。
- Webhook ルート結合: 署名不一致 → 401、正署名 → 200。

## 8. 実装ロードマップ

1. `domain/notification/provider.ts`（port + shouldNotify）
2. `domain/notification/messages.ts` + test
3. `infrastructure/line/line-notification-provider.ts` + test
4. `infrastructure/line/webhook.ts`（署名）+ test
5. `POST /api/webhooks/line` を createApp に追加（deps.lineChannelSecret）
6. server.ts 配線・検証・コミット
