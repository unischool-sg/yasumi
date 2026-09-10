# Admin ユーザー管理パネルの強化

## 目的
管理画面のユーザー管理をもっと実用的に。ユーザーの**名前表示**（LINE displayName）、
**簡易メッセージ送信**、**購読の編集**（追加/削除/通知ON-OFF）を可能にする。

## 現状
- `admin/src/pages/Users.tsx` は内部ID/lineUserId/登録日の一覧のみ（閲覧）。
- backend `GET /api/admin/users`（一覧）/ `GET /subscriptions`（全件）だけ。ユーザー個別操作なし。

## 実装

### backend（admin API）— `backend/src/api/admin/app.ts`
`AdminAppDeps` に追加: `lineAccessToken?`（プロフィール取得用）, `notificationProvider?`, `pushProvider?`（メッセージ送信用）。
app.ts の `createAdminApp(...)` 呼び出しに引き回す（server.ts で access token / providers を渡す）。

新エンドポイント（すべて認証必須・既存の admin 認証下）:
- `GET /users/:id` … ユーザー詳細 `{ id, lineUserId, createdAt, deviceTokenCount,
  subscriptions:[{schoolId, schoolName, notificationEnabled}], profile:{displayName,pictureUrl}|null }`。
  profile は LINE `GET /v2/bot/profile/{lineUserId}`（bot access token）。未取得/未友だちは null。
- `POST /users/:id/message` `{text}` … 本人へ通知（`notifyUser` = デバイストークンあれば FCM / 無ければ LINE）。
- `POST /users/:id/subscriptions` `{schoolId}` … 購読追加。
- `PATCH /users/:id/subscriptions/:schoolId` `{notificationEnabled}` … 通知ON/OFF。
- `DELETE /users/:id/subscriptions/:schoolId` … 購読削除。

補助:
- `infrastructure/line/line-api.ts`: `getLineProfile(accessToken, userId)`（fetch 注入可・失敗時 null）。
- `repositories/subscriptions.ts`: `listSubscriptionsWithSchoolByUser(db, userId)`（schools と join して schoolName 付与）。
- 既存再利用: `usersRepo.getLineUserId` / `deviceTokensRepo.listTokensByUser` /
  `subsRepo.upsertSubscription` / `removeSubscription` / `notifyUser`（dispatch.ts）。

### frontend（admin SPA）
- `admin/src/api/client.ts`: `getUser(id)`, `sendUserMessage(id,text)`, `addUserSubscription(id,schoolId)`,
  `setUserSubscription(id,schoolId,enabled)`, `removeUserSubscription(id,schoolId)` と型追加。
- `admin/src/pages/UserDetail.tsx`（新規 / route `/users/$id`）:
  - プロフィールカード（アイコン・displayName・lineUserId・登録日・デバイス数）
  - 購読セクション（学校名一覧 / 通知トグル / 削除 / 学校検索して追加）
  - メッセージ送信（テキスト＋送信ボタン、Toast で結果）
- `admin/src/pages/Users.tsx`: 行クリックで詳細へ遷移。
- `admin/src/router.tsx`: `/users/$id` を追加。

## 検証
- backend: `bun test`（admin の購読追加/トグル/削除・ユーザー詳細を DB-gated、getLineProfile はユニット）。
- admin: `tsc`＋`vite build`。手元で Toast/遷移確認。

## スコープ外
- 一覧での全ユーザー名一括表示（LINE API を N 回叩くため。詳細画面でのみ取得）。
- メッセージのテンプレート/一斉送信。
