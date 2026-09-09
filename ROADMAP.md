# やすみ？ 開発ロードマップ

> [PRD.md](./PRD.md) の §58（MVP実装順）をベースに、
> 各仕様書（[backend/SPEC.md](./backend/SPEC.md) / [backend/CRON.md](./backend/CRON.md) /
> [frontend/SPEC.md](./frontend/SPEC.md) / [docker/SPEC.md](./docker/SPEC.md)）の
> 方針変更（同一プロセス cron・30分ごと・`app.fetch` 駆動）を反映した実装計画。

---

## マイルストーン全体像

```text
M0 基盤セットアップ
   ↓
M1 気象庁 Adapter（データ取得の芯）
   ↓
M2 Rule Engine（判定ロジックの芯）
   ↓
M3 DB / Drizzle（永続化）
   ↓
M4 API + LIFF 認証（ユーザーが繋がる）
   ↓
M5 学校登録 UI（データが入る）
   ↓
M6 LINE Push（通知が出る）
   ↓
M7 Cron 判定パイプライン（自動で回る）
   ↓
M8 デプロイ / 一般公開
```

判定に必要な「芯」を先に作る（M1→M2）。芯があれば DB や UI が無くても
単体テストで判定ロジックを検証できる。PRD §58 と同方針。

---

## M0. 基盤セットアップ

**目的**: 全員が同じ土台で開発を始められる状態。

- [ ] `backend/` 雛形: `package.json` / `tsconfig.json` / Hono 起動 (`server.ts`) / ESLint・Prettier
- [ ] `frontend/` 雛形: Vite + React + TS + Tailwind + `@line/liff`
- [ ] `docker/`: `docker-compose.yml`（api + postgres の2コンテナ）/ `.env.example`
- [ ] `Makefile`: `up` / `down` / `logs` / `migrate` / `dev` 等
- [ ] `README.md`: セットアップ手順・構成概要
- [ ] `.gitignore`（`.env` / `node_modules` / `dist` 等）

**完了条件**: `make up` で api と postgres が起動し、`GET /health` が 200 を返す。

---

## M1. 気象庁 Adapter（PRD §31, §32, §33 / Phase 1）

**目的**: 指定地域コード → 現在の警報 `Warning[]` を取得できる。

> 📄 **詳細仕様確定済み**: [backend/JMA_ADAPTER.md](./backend/JMA_ADAPTER.md)

- [x] `domain/warning/provider.ts`: `WarningProvider` ポート
- [x] `infrastructure/jma/`: `JmaWarningProvider`（気象庁レスポンス → `Warning[]` 正規化）+ `parse.ts` / `warning-codes.ts`
- [x] 地域コード基準の取得（名称でなくコード。都道府県 JSON をバッチ取得）
- [x] 一括取得＋TTLキャッシュ（学校単位でリクエストしない / §33）
- [x] 取得失敗時は例外 → 上位で `UNKNOWN`（§51）
- [x] 気象庁レスポンス構造の調査（JMA_ADAPTER.md §2 に記録）

**完了条件**: 地域コード配列を渡すと `Warning[]` が返る。JMA固有構造は Domain に漏れない。単体テストあり。
→ **達成**（parse 8 + provider 6 テスト green / 実 API スモーク OK / typecheck OK）

**依存**: なし（最優先）

---

## M2. Rule Engine（PRD §14, §27〜§30 / Phase 2）

**目的**: 地域 + 警報種類 → 判定結果 `CheckResult`（+ 判定根拠）。

> 📄 **詳細仕様確定済み**: [backend/RULE_ENGINE.md](./backend/RULE_ENGINE.md)
> （型設計 / 確定シグネチャ / アルゴリズム / エッジケース / テストマトリクス T1〜T13 / TDD ステップ）

- [x] `@yasumi/shared`: `RuleCondition` / `School` / `SchoolRule` / `EvaluationResult` 型を追加
- [x] `domain/rule/evaluate.ts`: `evaluateSchoolRule({ school, rule, activeWarnings }): EvaluationResult`（純粋関数）
- [x] MVP判定: 対象地域いずれか AND 対象警報いずれか（§29 OR判定）+ 判定根拠 `matchedWarnings` を返す
- [x] 将来の複雑ルール（§30）を見据えた `RuleCondition` 判別ユニオン設計（型のみ、実装しない）

**完了条件**: 判定例（§28）を含むテストマトリクス（T1〜T13）が green。DB・ネットワーク・時刻に非依存。→ **達成**（13 テスト green / typecheck OK）

**依存**: 既存 `@yasumi/shared`（`CheckResult` / `Warning`）のみ。M1 と**並行着手可能**。

---

## M3. DB / Drizzle（PRD §38〜§47 / Phase 3）

**目的**: School / Area / Rule / Subscription 等を永続化。

> 📄 **詳細仕様確定済み**: [backend/DB.md](./backend/DB.md)

- [x] `infrastructure/db/schema.ts`: Drizzle スキーマ（全10テーブル）
- [x] UNIQUE制約: `warning_checks`(§35) / `notifications`(§36)
- [x] マイグレーション生成・適用フロー（`drizzle.config.ts` / `migrate.ts` / `make migrate` / `make generate`）
- [x] リポジトリ層（users/schools/areas/school-config/rules/subscriptions/warning-checks/notifications）
- [x] `areas` の初期データ投入（気象庁 class20s コード / 兵庫県阪神地域 / `make seed`）

**完了条件**: マイグレーションが通り、各リポジトリの CRUD が結合テストで動く。
→ **達成**（migrate/seed OK・結合スモークで CRUD + UNIQUE 冪等 §35/§36 + Rule Engine 連携を確認）

**依存**: なし（M1/M2 と並行可）

---

## M4. API + LIFF 認証（PRD §21, §37 / Phase 4）

**目的**: LIFF ログイン → User 作成 → 学校検索 → 購読までを API で。

> 📄 **詳細仕様確定済み**: [backend/API.md](./backend/API.md)

- [x] LIFF IDトークンのサーバー側検証ミドルウェア（`lineUserId` を信用しない / §21）
- [x] `GET /api/me`（初回 users + line_accounts 作成）
- [x] `GET /api/schools/:id` / `search?q=`
- [x] `GET /api/areas` / `?prefecture=`
- [x] `GET/POST/DELETE /api/me/subscriptions`
- [x] Frontend: `useLiff` / API クライアント / ホーム(購読一覧)・学校検索・購読画面
- [x] Rate Limit / secure-headers / cors / 入力バリデーション(zod)（§54）

**完了条件**: LIFF 上でログイン → 学校を検索 → 購読でき、DBに反映される。
→ **達成**（API 結合テスト 7 件 green・frontend build/typecheck OK。LIFF 実機は要 LINE 環境）

**依存**: M3（DB）

---

## M5. 学校登録 UI + API（PRD §13, §23 / Phase 5）

**目的**: 学校名 → 対象地域 → 対象警報 → 判定時刻を登録できる。

- [x] `POST /api/schools` / `PATCH /api/schools/:id`（作成者/管理者のみ / §23）
- [x] `GET/POST /api/schools/:id/rules` / `PATCH,DELETE /api/rules/:id`
- [x] Frontend: 4ステップ登録（基本情報 / 地域複数選択 / 警報複数選択 / ルール）
- [x] **`check_time` は30分刻み（HH:00 / HH:30）に制限**（UI select + API zod 正規表現）
- [x] 学校編集権限チェック（`authz.ts` / 作成者 or 管理者 §23）

**完了条件**: 未登録学校を新規登録し、地域・警報・30分刻みルールまで保存できる。
→ **達成**（API 結合テストで作成/30分検証/権限403/削除を確認・frontend build OK）

**依存**: M4（認証・User）、M3（DB）

---

## M6. LINE Push（PRD §18, §19, §50, §52 / Phase 6）

**目的**: 判定結果を LINE Messaging API で通知できる。

> 📄 **詳細仕様確定済み**: [backend/LINE.md](./backend/LINE.md)

- [x] `infrastructure/line/`: Push 送信 / Webhook 署名検証（§54）
- [x] `NotificationProvider` 抽象 + `LineNotificationProvider`（§50）
- [x] 通知文面: 午前休 / 全日休校 / UNKNOWN（§18, §52）
- [x] 通知条件: NORMAL は通知しない（`shouldNotify` §19）
- [x] `POST /api/webhooks/line`（署名検証・最小実装）

**完了条件**: 任意の User へ判定結果の Push を送れる。署名検証が効いている。
→ **達成**（provider/メッセージ/署名 のテスト green・Webhook ルート 401/200 確認）

**依存**: M4（User / line_accounts）

---

## M7. Cron 判定パイプライン（PRD §26, §34〜§36, §57 / [CRON.md](./backend/CRON.md) / Phase 7）

**目的**: 30分ごとに自動で判定 → 保存 → 通知が回る。

- [x] `POST /api/internal/run-check`（内部トークン認可 / §54）
- [x] 判定パイプライン（§57）: 該当ルール検索 → 警報一括取得 → 評価 → warning_checks 保存 → Subscription → Push → notifications 保存
- [x] `cron.ts`: `startCron(app)` で毎時 :00 / :30 に `app.fetch` 発火
- [x] in-flight guard（多重発火防止）/ graceful shutdown で `stop()`
- [x] 判定の確定性（§34）: 発火時点の事実を保存し後で変えない（保存済み result を通知に採用）
- [x] 冪等性検証: 再起動・重複発火でも二重にならない（§35, §36）
- [x] JST 基準の時刻・`target_date` 処理（`shared/jst.ts`）
- [x] `GET /api/schools/:id/status` / `history`（ホーム画面用）

**完了条件**: MVP完成シナリオ（§59）が通る —
購読済み学校で、朝の判定時刻に警報があれば「午前休」の LINE 通知が届く。
→ **達成**（HTTP 経路の E2E で run-check→AM_OFF 通知→status 反映を確認・冪等/UNKNOWN もテスト green）

**依存**: M1, M2, M3, M6（全て）

---

## M8. デプロイ / 一般公開（PRD §58 Phase 8）

**目的**: 本番運用開始。

> 📄 **手順書**: [DEPLOY.md](./DEPLOY.md)

- [x] `docker/api.Dockerfile`（oven/bun 2ステージ / `bun run src/server.ts`）
- [x] Frontend ビルド配信方針を確定（Cloudflare Pages / docker SPEC §6・DEPLOY §5）
- [x] 免責表示の常設（§53 / フッター + 通知文面）
- [x] 本番イメージのコンテナ E2E 確認（health / migrate / seed / run-check / 実 JMA 取得）
- [ ] Cloudflare Tunnel 設定（api のみ公開）※要インフラ環境
- [ ] LINE 公式アカウント / LIFF / リッチメニュー（§20）設定 ※要 LINE 環境
- [ ] 本番 `.env` / Secret 管理 / DB バックアップ運用 ※要インフラ環境
- [ ] 実ユーザーでの動作確認 → 一般公開 ※要 LINE 環境

**完了条件**: 本番環境で §59 のシナリオが実ユーザーで成立する。
→ コードは完成。残るはインフラ/外部サービス設定（DEPLOY.md 手順に沿って実施）。

---

## 依存関係マップ

```text
M0 ─┬─ M1 ─┐
    ├─ M2 ─┤（M1/M2/M3 は並行可）
    └─ M3 ─┴─ M4 ─┬─ M5 ─┐
                   └─ M6 ─┴─ M7 ─ M8
```

- **並行可能**: M1 / M2 / M3 は独立して着手できる（芯とDBは疎）。
- **クリティカルパス**: M0 → M3 → M4 → M6 → M7 → M8。

---

## MVP スコープ外（PRD §5, §30, §60）

以下は MVP に含めない（将来機能として記録）:
警報解除の扱い / 特別警報即休校 / 台風・大雪・交通機関 / 複雑な AND ルール /
編集提案・承認フロー / 複数学校切替の高度化 / 有料プラン /
Web Push・Discord・Email 通知 / 通常登校通知の設定 UI。

> ただし拡張点（`NotificationProvider` 抽象・Rule Engine の型設計）は
> MVP 時点で"差し込める形"にしておく。
