# やすみ？ API / 認証 仕様書

> 本書は [PRD.md](../PRD.md) §21, §37, §54 を具体化した詳細仕様。
> [ROADMAP.md](../ROADMAP.md) の **M4 / M5** に対応する（M4: me/schools/areas/subscriptions、M5: schools 作成/rules）。

---

## 1. 目的と責務境界

Hono API サーバー。LIFF フロントからの HTTP を処理し、DB リポジトリ（M3）を呼ぶ。
判定（M2）・警報取得（M1）・cron（M7）は呼ばない（それらは M7 パイプラインが使う）。

## 2. アプリ構成（テスト可能な factory）

```ts
// backend/src/api/app.ts
createApp({ db, verifyIdToken }): Hono
```

- 依存（DB クライアント・IDトークン検証）を注入する factory。
- `server.ts` は本番依存（`getDb()` / LINE 検証）を渡す。テストは test DB + fake 検証を渡す。
- 既存 `/health` はここに統合。

## 3. 認証（PRD §21）

- フロントは `liff.getIDToken()` を取得し `Authorization: Bearer <idToken>` で送る。
- **サーバー側検証**: `verifyIdToken(idToken)` が LINE のトークン検証を行い `{ lineUserId }` を返す。
  - 本番: `POST https://api.line.me/oauth2/v2.1/verify`（`id_token` + `client_id=LIFF_CHANNEL_ID`）。`sub` を lineUserId とする。
  - **フロントの lineUserId を信用しない**（トークンからサーバーが導出）。
- `authMiddleware`: Bearer を検証 → `usersRepo.findOrCreateByLineUserId` → `c.set("userId", ...)`。
  失敗時 401。
- `/health` と Webhook 以外は認証必須。

## 4. エンドポイント（PRD §37）

| メソッド | パス | 認証 | 概要 |
| --- | --- | --- | --- |
| GET | `/health` | 無 | ヘルスチェック |
| GET | `/api/me` | 要 | 現在ユーザー（初回作成） |
| GET | `/api/schools/search?q=` | 要 | 学校名検索（PRD §11） |
| GET | `/api/schools/:id` | 要 | 学校詳細（対象地域/警報/ルール含む） |
| POST | `/api/schools` | 要 | 学校作成（M5 / created_by=自分） |
| PATCH | `/api/schools/:id` | 要 | 学校更新（作成者/管理者のみ §23 / M5） |
| GET | `/api/areas?prefecture=` | 要 | 地域一覧 |
| GET | `/api/schools/:id/rules` | 要 | ルール一覧（M5） |
| POST | `/api/schools/:id/rules` | 要 | ルール作成（M5・30分刻み検証） |
| PATCH | `/api/rules/:id` | 要 | ルール更新（M5） |
| DELETE | `/api/rules/:id` | 要 | ルール削除（M5） |
| GET | `/api/me/subscriptions` | 要 | 購読一覧 |
| POST | `/api/me/subscriptions` | 要 | 購読作成（{schoolId}） |
| DELETE | `/api/me/subscriptions/:schoolId` | 要 | 購読解除 |
| GET | `/api/schools/:id/status` | 要 | 今日の状態（M7 で実装） |
| GET | `/api/schools/:id/history` | 要 | 判定履歴（M7 で実装） |

## 5. バリデーション / セキュリティ（PRD §54）

- 入力検証: `zod` + `@hono/zod-validator`。
- `check_time` は `^([01]\d|2[0-3]):(00|30)$`（30分刻み / M5）。
- `secure-headers` / `cors`（LIFF オリジン許可）/ 簡易レートリミット（メモリ）。
- 認可: 学校/ルール編集は作成者 or 管理者のみ（§23）。管理者判定は MVP では env の許可 lineUserId 集合 or 未実装フラグ。

## 6. テスト

- `app.test.ts`（`createApp` + test DB(docker) + fake verifyIdToken）:
  - 認証なし → 401
  - `/api/me` 初回作成 → 冪等
  - 学校作成 → 検索 → 詳細取得
  - areas 取得
  - 購読 作成/一覧/解除
- 実行は docker postgres を使う結合テスト。CI 前提。

## 7. 実装ロードマップ

1. deps（zod / @hono/zod-validator / hono ミドルウェア）
2. `verifyIdToken`（LINE 検証、注入可能）
3. `authMiddleware`
4. `createApp` + routes（me/schools/areas/subscriptions）
5. `server.ts` 配線
6. 結合テスト（docker postgres）
7. M5 で schools 作成・rules・権限を拡張
