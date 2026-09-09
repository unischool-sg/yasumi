# やすみ？ Backend 仕様書

> 本書は [PRD.md](../PRD.md) を Backend 観点で具体化したもの。
> Backend は **単一プロセス**（API サーバー）で動作し、判定バッチは
> 同一プロセス内の cron で駆動する（PRD §7, §56 から方針変更 / 詳細は [CRON.md](./CRON.md)）。

---

## 1. 目的と責務

| 構成 | 役割 |
| --- | --- |
| **API** (`dist/server.js`) | LIFF フロントからの HTTP リクエスト処理、LINE Webhook 受信、CRUD |
| **Cron**（API プロセス内） | 30 分ごとに発火し、`app.fetch` で内部判定エンドポイントを叩く（[CRON.md](./CRON.md)） |

判定パイプライン（該当時刻の学校ルールを判定 → 保存 → LINE Push）は
内部エンドポイント `POST /api/internal/run-check` として実装し、cron から `app.fetch` で呼ぶ。
`domain/` と `infrastructure/` を共有し、外部依存（気象庁・LINE・DB）は Infrastructure 層で吸収する。

> ⚠️ PRD §48/§56 の「別コンテナ Scheduler・1 分ごと」から変更:
> **同一プロセス内 cron・30 分ごと・`app.fetch` 駆動**とする。

---

## 2. 技術スタック

```text
Bun             … ランタイム / パッケージマネージャ / テストランナー
Hono            … HTTP フレームワーク
TypeScript
Drizzle ORM     … PostgreSQL アクセス
PostgreSQL 17
```

> M0 でランタイムを **Bun** に確定（モノレポ = Bun workspace）。
> PRD の「Node.js」前提から変更している。

- 実行: **`bun run src/server.ts`**（TS を直接実行。事前ビルド不要）
- テスト: **`bun test`**（Bun 内蔵ランナー）
- 型チェック: `tsc --noEmit`
- 実行環境変数: `DATABASE_URL`, `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN`, `INTERNAL_CRON_TOKEN`, `PORT`

---

## 3. ディレクトリ構造

PRD §49 を `backend/` 配下に再配置する。

```text
backend/
├─ src/
│  ├─ domain/               … ビジネスロジック（外部依存を持たない）
│  │  ├─ school/            … School / Area / WarningType エンティティ
│  │  ├─ warning/           … Warning 型、警報の抽象
│  │  ├─ rule/              … Rule Engine（evaluateSchoolRule）
│  │  └─ notification/      … Notification エンティティ、判定結果種別
│  │
│  ├─ infrastructure/       … 外部世界とのアダプタ
│  │  ├─ db/                … Drizzle スキーマ・リポジトリ実装
│  │  ├─ jma/               … 気象庁アダプタ（JmaWarningProvider）
│  │  └─ line/             … LINE Messaging API / 署名検証
│  │
│  ├─ api/                  … Hono ルーティング・ハンドラ・認証ミドルウェア
│  │  └─ internal/          … cron が app.fetch で叩く内部判定エンドポイント
│  ├─ cron.ts               … 30 分ごとに発火する同一プロセス cron（→ CRON.md）
│  ├─ server.ts             … entrypoint。app 起動時に startCron(app) を呼ぶ
│  └─ shared/               … 共通型・エラー・ユーティリティ
│
├─ drizzle/                 … マイグレーションファイル
├─ package.json
├─ tsconfig.json
└─ drizzle.config.ts
```

**依存方向**: `api`（cron 含む）→ `domain` ← `infrastructure`
Domain 層は気象庁・LINE・DB の具象を一切 import しない（PRD §32）。

---

## 4. Domain 層

### 4.1 判定結果種別（PRD §14）

```ts
type CheckResult =
  | "NORMAL"    // 通常登校
  | "WAIT"      // 自宅待機
  | "AM_OFF"    // 午前休
  | "PM_START"  // 午後から登校
  | "FULL_OFF"  // 全日休校
  | "UNKNOWN";  // 判定不能
```

### 4.2 Warning 型（PRD §31）

```ts
interface Warning {
  areaCode: string;
  areaName: string;
  warningType: string;
  status: "active" | "cancelled";
  issuedAt: Date;
}
```

### 4.3 Rule Engine（PRD §27〜§29 / 詳細は [RULE_ENGINE.md](./RULE_ENGINE.md)）

警報取得と判定を分離する純粋関数。**実装済み**（`backend/src/domain/rule/evaluate.ts`、テスト T1〜T13）。
型は `@yasumi/shared`（`School` / `SchoolRule` / `RuleCondition` / `EvaluationResult`）を再利用する。

```ts
function evaluateSchoolRule(input: {
  school: School;          // 対象地域(areaCodes)・対象警報(warningTypes)を含む
  rule: SchoolRule;        // checkTime / condition / result
  activeWarnings: Warning[];
}): EvaluationResult;       // { matched, result, matchedWarnings }
```

`matchedWarnings` は判定根拠（ホーム/通知の「理由」表示 / PRD §16, §17, §64）。

MVP の判定条件（PRD §29 OR判定）:

```text
（対象地域のいずれか）AND（対象警報のいずれか）が status="active"
→ matched = true  → result = rule.result、matchedWarnings = 該当警報（重複排除）
→ matched = false → result = NORMAL、matchedWarnings = []
```

> 取得失敗時の `UNKNOWN` は engine の責務外。呼び出し側（M7）が engine を呼ばず確定する（§51）。

将来の複雑ルール（AND / 特別警報即休校 / 解除条件 / 交通機関）は
MVP では実装しないが、拡張可能な構造にする（PRD §30）。

---

## 5. Infrastructure 層

### 5.1 JMA Adapter（PRD §31, §32, §33）

```text
気象庁 → JmaWarningProvider → Warning[]
```

- 気象庁固有の XML/JSON 構造をここで吸収し、`Warning[]` に正規化。
- **地域コード基準**でリクエスト（名称ではなく気象庁地域コード / PRD §9）。
- **キャッシュ**: 学校単位でリクエストしない。1 回の判定サイクルで
  必要地域の警報を一括取得し、全学校で共有する（PRD §33）。
- 取得失敗時は例外を投げ、上位で `UNKNOWN` 扱いにする（PRD §51）。

### 5.2 LINE Adapter（PRD §18, §21, §54）

- Push 通知送信（Messaging API）。
- Webhook 署名検証（`X-Line-Signature` を `LINE_CHANNEL_SECRET` で検証）。
- LIFF から送られる ID トークンをサーバー側で検証し `lineUserId` を確定。
  **フロントの `lineUserId` をそのまま信用しない**（PRD §21）。

### 5.3 通知抽象化（PRD §50, §62）

```ts
interface NotificationProvider {
  send(user: User, notification: Notification): Promise<void>;
}
```

MVP: `LineNotificationProvider` のみ。
将来: WebPush / Discord / Email。通知処理を LINE 依存にしない。

### 5.4 DB（Drizzle）

PRD §38〜§47 のスキーマを Drizzle で定義。テーブル:

`users` / `line_accounts` / `schools` / `areas` / `school_areas` /
`school_warning_types` / `school_rules` / `subscriptions` /
`warning_checks` / `notifications`

制約の要点:
- `warning_checks`: UNIQUE(`school_id`, `rule_id`, `target_date`)（PRD §35 二重判定防止）
- `notifications`: UNIQUE(`user_id`, `school_id`, `rule_id`, `target_date`)（PRD §36 二重通知防止）

---

## 6. API 仕様（PRD §37）

全エンドポイントは LIFF 認証を前提（Webhook を除く）。

### User
```text
GET    /api/me
```

### Schools
```text
GET    /api/schools
GET    /api/schools/:id
POST   /api/schools
PATCH  /api/schools/:id          … 作成者 or 管理者のみ（PRD §23）
```

### Search
```text
GET    /api/schools/search?q=
```

### Areas
```text
GET    /api/areas
GET    /api/areas?prefecture=兵庫県
```

### Rules
```text
GET    /api/schools/:id/rules
POST   /api/schools/:id/rules
PATCH  /api/rules/:id
DELETE /api/rules/:id
```

### Subscription
```text
GET    /api/me/subscriptions
POST   /api/me/subscriptions
DELETE /api/me/subscriptions/:schoolId
```

### Status / History
```text
GET    /api/schools/:id/status     … 今日の判定状態（ホーム画面用）
GET    /api/schools/:id/history    … 判定履歴
```

### LINE
```text
POST   /api/webhooks/line          … 署名検証必須
```

### Internal（cron 専用 / 外部非公開）
```text
POST   /api/internal/run-check     … 判定パイプライン。x-internal-token で認可（→ CRON.md）
```

---

## 7. 認証・認可

- **認証**: LIFF ID トークンをサーバー側で検証 → 内部 User に紐付け（PRD §21）。
  初回は `users` + `line_accounts` を作成。
- **認可**: 学校編集（PATCH schools / rules）は **作成者 + 管理者のみ**（PRD §23）。
- **共有モデル**: 学校設定はユーザー単位でなく共有（PRD §22）。

---

## 8. 判定バッチ仕様（PRD §26, §57 / 詳細は [CRON.md](./CRON.md)）

**同一プロセス内 cron が 30 分ごと（毎時 00 / 30 分）に発火**し、
`app.fetch` で内部エンドポイント `POST /api/internal/run-check` を叩く。
判定は現在時刻に該当する `school_rules`（30 分粒度）のみ処理する。

```text
cron 発火（毎時 :00 / :30）
 ↓ app.fetch("POST /api/internal/run-check")  … 内部トークンで認可
 ↓ 発火時刻の HH:MM に一致する SchoolRule を検索
 ↓ 対象学校の必要地域を集約 → 警報情報を一括取得（キャッシュ共有）
 ↓ 学校ごとに Rule Engine で評価
 ↓ warning_checks 保存（UNIQUE で二重判定防止）
 ↓ 各学校の Subscription 取得
 ↓ 通知対象 User へ LINE Push
 ↓ notifications 保存（UNIQUE で二重通知防止）
```

### 判定タイミングの確定性（PRD §34）
`08:00 時点で警報あり → 午前休` という判定結果は、
08:01 に解除されても変更しない（その時刻の事実として保存）。

### 通知条件（PRD §19）
- `NORMAL` は通知しない（将来設定で ON 可能）。
- 通知対象: `WAIT` / `AM_OFF` / `PM_START` / `FULL_OFF` / `UNKNOWN`。

### 冪等性
プロセス再起動や cron の重複発火でも UNIQUE 制約により判定・通知が重複しない（PRD §35, §36）。
また cron 側でも in-flight guard で同時実行を 1 本に絞る（[CRON.md](./CRON.md) §7）。

---

## 9. エラー処理（PRD §51, §52）

- 気象情報取得失敗 → `NORMAL` にせず **`UNKNOWN`** として保存・通知。
- UNKNOWN 通知は「判定できませんでした / 学校公式を確認」の文面（PRD §52）。

---

## 10. セキュリティ（PRD §54, §55）

必須:
- LINE 認証情報のサーバー側検証
- LINE Webhook 署名検証
- API 認可（学校編集権限チェック）
- Rate Limit / CSRF / XSS / SQL Injection 対策
- Secret は環境変数管理

保存する個人情報は最小限（内部 User ID / LINE User ID / 購読学校のみ）。
本名・住所・電話番号・GPS は保存しない。

---

## 11. 実装順（PRD §58）

1. **JMA Adapter**（指定地域 → 現在の警報）
2. **Rule Engine**（地域 + 警報種類 + 判定時刻 → 判定結果）
3. **DB / Drizzle**（School / Area / Rule / Subscription）
4. **API + LIFF 認証**
5. **学校登録 API**
6. **LINE Push**
7. **Scheduler**（完全自動判定）
