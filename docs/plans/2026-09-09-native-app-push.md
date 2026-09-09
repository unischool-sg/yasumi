# ネイティブアプリ版（Capacitor + 無料FCMプッシュ）実装

承認済みマスタープラン: `~/.claude/plans/plan-lucky-river.md`。本 doc は実装単位の記録。

## 目的
LINE Messaging API プッシュは無料枠超で従量課金。ネイティブアプリ＋FCMで実質無料の通知にする。
同一 React アプリを Capacitor でネイティブ化し、LINE ログインの同一アカウントのまま通知を FCM に送り分け。

## 実装単位（Part 単位で commit）
- **C1（本コミット）**: backend の `device_tokens` テーブル＋repo＋`/api/me/device-tokens`（POST/DELETE）＋テスト。
- **C2**: `NotificationTarget` 拡張＋`FcmNotificationProvider`(HTTP v1)＋`run-check` の送り分け（デバイストークン→FCM、無ければLINE）＋テスト。
- **A**: フロントの認証プロバイダ抽象化（`useLiff`→`useAuth`、LIFF/native/mock）。web 無回帰。
- **B**: Capacitor シェル（iOS/Android）＋`@capacitor-firebase/messaging`＋LINEログイン(native OAuth)。
- **D**: Firebase/FCM サービスアカウント（サーバー限定 secret）、APNs キー、ストア、env。

## C1 詳細
- `schema.ts`: `device_tokens { id, userId→users.id, platform('ios'|'android'|'web'), token unique, createdAt, lastSeenAt }`（1ユーザー多デバイス。`line_accounts` に倣う）。drizzle migration 生成。
- `repositories/device-tokens.ts`: `upsertDeviceToken`(token 競合で userId/platform/lastSeenAt 更新) / `listTokensByUser` / `removeDeviceToken`。
- `app.ts`: `POST /api/me/device-tokens`（zValidator: token, platform enum）、`DELETE /api/me/device-tokens?token=`。`/me/subscriptions` と同じ `c.get("userId")` スコープ。
- test: 登録→upsert冪等→削除（DB-gated）。

## 検証
`bun run typecheck` / `bun test`（DB-gated は TEST_DATABASE_URL 時）。web 無回帰。
