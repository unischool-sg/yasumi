# やすみ？ DB / Drizzle 仕様書

> 本書は [PRD.md](../PRD.md) §38〜§47 を Drizzle 実装向けに具体化した詳細仕様。
> [ROADMAP.md](../ROADMAP.md) の **M3** に対応する。

---

## 1. 目的と責務境界

**やること:** PostgreSQL のスキーマ（Drizzle）・マイグレーション・DB クライアント・
リポジトリ層・初期 `areas` シードを用意する。

**やらないこと:** API ハンドラ（M4）・cron パイプライン（M7）。
リポジトリは「純粋な永続化操作」だけを提供し、判定・認可・通知は上位層。

---

## 2. 技術選定

```text
drizzle-orm            … スキーマ定義・クエリ
drizzle-orm/postgres-js … ドライバ
postgres (postgres.js)  … PostgreSQL クライアント（Bun 互換）
drizzle-kit (dev)       … マイグレーション生成
```

- 接続は `DATABASE_URL`。`backend/src/infrastructure/db/client.ts` で単一インスタンスを生成。
- マイグレーションは `backend/drizzle/` に生成。適用は `make migrate`（M3 で実装）。

---

## 3. スキーマ（PRD §38〜§47）

`backend/src/infrastructure/db/schema.ts` に全10テーブルを定義。

| テーブル | 主キー | 要点 |
| --- | --- | --- |
| `users` | `id` (uuid) | 内部ユーザー |
| `line_accounts` | `user_id` (uuid) | `line_user_id` UNIQUE |
| `schools` | `id` (uuid) | name/prefecture/city/website_url/rules_url/created_by |
| `areas` | `code` (varchar) | 気象庁地域コード。name/prefecture |
| `school_areas` | (`school_id`,`area_code`) | 対象地域 |
| `school_warning_types` | (`school_id`,`warning_type`) | 対象警報 |
| `school_rules` | `id` (uuid) | school_id/check_time(TIME)/result/message |
| `subscriptions` | (`user_id`,`school_id`) | notification_enabled |
| `warning_checks` | `id` (uuid) | **UNIQUE(school_id,rule_id,target_date)**（§35 二重判定防止） |
| `notifications` | `id` (uuid) | **UNIQUE(user_id,school_id,rule_id,target_date)**（§36 二重通知防止） |

- `warning_checks.result` / `school_rules.result` は `CheckResult`（@yasumi/shared）を文字列で保持。
- `warning_checks.raw_data` は JSONB（判定時の警報スナップショット）。
- `check_time` は 30分刻み（HH:00/HH:30）だが DB は `TIME` 型。刻み制約は API/UI 側（M5）。

---

## 4. リポジトリ層

`backend/src/infrastructure/db/repositories/` に、上位層が必要とする操作のみ用意する。

| リポジトリ | 主な操作 | 利用先 |
| --- | --- | --- |
| `users` | `findOrCreateByLineUserId(lineUserId)` | M4 認証 |
| `schools` | `create` / `findById` / `search(q)` / `update` | M4/M5 |
| `schoolConfig` | 対象地域・対象警報・ルールの取得/設定 | M5/M7 |
| `areas` | `list` / `listByPrefecture` | M4/M5 |
| `subscriptions` | `listByUser` / `upsert` / `remove` / `listEnabledBySchool` | M4/M7 |
| `rules` | `listBySchool` / `create` / `update` / `delete` / `listByCheckTime(hhmm)` | M5/M7 |
| `warningChecks` | `upsert`(UNIQUE) / `findBySchoolAndDate` | M7 |
| `notifications` | `createIfAbsent`(UNIQUE) | M7 |

> `warning_checks` / `notifications` は UNIQUE 制約 + `ON CONFLICT DO NOTHING` で冪等化（§35/§36）。

---

## 5. ドメイン型との対応

- リポジトリは DB 行（snake_case）を `@yasumi/shared` の型（camelCase: `School`/`SchoolRule` 等）へマップする。
- Rule Engine（M2）が使う `School.areaCodes` / `warningTypes` は
  `school_areas` / `school_warning_types` を集約して組み立てる（`schoolConfig` リポジトリ）。

---

## 6. シード

`areas` に気象庁地域コードの初期データを投入（まず兵庫県の主要市）。
`backend/src/infrastructure/db/seed-areas.ts` + `make seed`（任意）。

---

## 7. テスト / 検証

- **マイグレーション生成**: `drizzle-kit generate` が `backend/drizzle/*.sql` を出力。
- **結合スモーク**: docker の postgres にマイグレーション適用後、
  user/school を作成→読み出し、`warning_checks` の UNIQUE 冪等（二重 upsert で1行）を確認。
- 型チェック `bun run typecheck` OK。

**完了条件（ROADMAP M3）**: マイグレーションが通り、主要リポジトリの CRUD が結合スモークで動く。

---

## 8. 実装ロードマップ

1. deps 追加（drizzle-orm / postgres / drizzle-kit）
2. `schema.ts` 全10テーブル + UNIQUE 制約
3. `drizzle.config.ts` + `drizzle-kit generate` でマイグレーション生成
4. `client.ts`（DATABASE_URL 接続）
5. リポジトリ層（§4）
6. `areas` シード（兵庫県）
7. Makefile: `migrate` 実装 + `seed`
8. 結合スモーク（docker postgres）→ 検証
