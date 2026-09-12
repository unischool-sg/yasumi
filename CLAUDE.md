# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト

「やすみ？」— 学校ごとの気象警報ルールから「今日、学校へ行く必要があるか」を自動判定し LINE で通知する LINE ミニアプリ / LIFF サービス。加えて学校向け有料 SaaS（教員ダッシュボード）と管理画面を持つ。詳細仕様は `PRD.md` と各 `*/SPEC.md`、`backend/*.md`。

## ワークフローのお約束（重要）

- **コミットメッセージに `Co-Authored-By:` フッターを付けない。**
- **PR 本文に「Generated with Claude Code」等のクレジットを付けない。**
- **こまめにコミットする**（論理単位で分割。大きな変更を一括コミットしない）。
- コミットメッセージにバッククォート/括弧を含むと zsh で失敗するため `git commit -F -` の heredoc を使う。

## モノレポ構成（Bun workspace）

- `backend/` — Hono on Bun。API＋プロセス内 cron。Drizzle ORM + PostgreSQL 17。
- `frontend/` — Vite + React 19 + MUI + LIFF（生徒/保護者向けミニアプリ）。
- `admin/` — Vite + React 19 + MUI + TanStack Router/Query/Table（社内管理画面）。
- `school/` — Vite + React 19 + MUI（教員ダッシュボード）。
- `landing/` — Astro 製 LP（静的 + @astrojs/sitemap）。
- `packages/shared/` — `@yasumi/shared`。backend/frontend/admin 共有の型・純関数（単一情報源）。

## よく使うコマンド

```bash
make install            # bun install
make dev-backend        # backend を --watch 起動 (http://localhost:3000/health)
make dev-admin          # 管理画面 (Vite)
make dev-frontend       # 生徒向け (Vite)
make typecheck          # shared → backend → frontend の型チェック
make test               # bun test（DB 系は TEST_DATABASE_URL 未設定だと skip）
make generate           # Drizzle マイグレーション SQL 生成（schema.ts 変更後）
make migrate            # api コンテナ内でマイグレーション適用
```

ワークスペース個別:
```bash
cd admin && bunx tsc --noEmit && bun run build   # admin の型＋ビルド（icon 解決確認にも有効）
cd backend && bunx tsc --noEmit                  # backend 型（テストファイル含む）
```
`bun run --filter <name>` は使えない（フィルタ名が一致しない）。`cd <ws> && bun run ...` を使う。

### テスト（DB-gated）

backend の DB テストは `TEST_DATABASE_URL` が必要。podman の `yasumi-test-pg`（port 55432 / user `postgres` / pass `test` / db `yasumi_test`）を使う。

```bash
# VM/コンテナが寝ていたら
podman machine start && podman start yasumi-test-pg
# テスト間のデータ蓄積で一意制約・件数系が壊れるため、フルラン前に作り直す
podman exec yasumi-test-pg psql -U postgres -c "DROP DATABASE IF EXISTS yasumi_test WITH (FORCE);" -c "CREATE DATABASE yasumi_test;"
# 実行（単一ファイルも可）
TEST_DATABASE_URL="postgres://postgres:test@localhost:55432/yasumi_test" bun test
TEST_DATABASE_URL="...same..." bun test src/api/admin/app.test.ts
```
テストは `beforeAll` で `drizzle/` のマイグレーションを流すので、schema 変更時は先に `make generate` で SQL を作ること。

## アーキテクチャの要点

### backend: 依存注入の app factory
`createApp(deps: AppDeps)`（`backend/src/api/app.ts`）が全ルートを組み立てる。`server.ts` が env を読んで providers を注入する。**env-gated provider パターン**: secret 未設定なら該当機能はドーマント（例外を投げず無効化）。

- `pushProvider`（FCM）未設定 → LINE のみ。
- `storage`（S3/RustFS ロゴ）未設定 → ロゴ機能無効。
- `adsConversionProvider`（Google Ads）未設定 → gclid は保存のみ。
- `adminJwtSecret` / `schoolJwtSecret` 未設定 → `/api/admin` / `/api/school` を登録しない。
- 各種 `discord*WebhookUrl` 未設定 → その通知を送らない。

新しい secret 依存機能は必ずこのパターンで足す（本番に安全にドーマントで載せてから SSH で env を設定）。

### 認証は3系統（別物）
- **LIFF**（生徒/保護者）: LINE ID トークン検証 → `/api/*`。
- **admin JWT**（管理画面）: `/api/admin/*`。superadmin/admin ロール。
- **teacher JWT**（教員）: `/api/school/*`。自校スコープ・owner/teacher ロール。

クライアント側の権限チェックは信頼しない。検証・認可はすべて backend。

### レイヤリング（backend）
`api/`（Hono ルート・zod 検証）→ `domain/`（純ロジック: rule 評価・通知 dispatch・plan ゲート・flow 実行）→ `infrastructure/`（`db/repositories/*`・LINE・Discord・S3・JMA アダプタ）。DB は Drizzle。FK 制約は張らず uuid カラムで表現し、カスケード削除は repo 側で明示する慣習。

### cron（同一プロセス）
`cron.ts` が 30分ごと（毎時 :00/:30、JST 境界に一致）に発火し、`app.fetch` で内部エンドポイントを叩く（`x-internal-token` 認可）。現在 `/api/internal/run-check`（警報判定パイプライン）と `/api/internal/run-flows`（フロー定期実行）を順に実行。新しい定期処理はこの tick に相乗りさせる（別スケジューラを増やさない）。JST 時刻ユーティリティは `backend/src/shared/jst.ts`。

### shared に置く判断
複数の面（admin と backend など）で同じロジックが必要なら `packages/shared` に純関数として置き単一情報源にする（例: フロー対象条件の評価 `matchesAudienceQuery`）。UI ラベル等の表示専用メタは各アプリ側に残す。

## デプロイ

`develop` に push → `product` への PR をマージすると self-hosted runner（`.github/workflows/deploy.yml`）が `~/yasumi-prod` へ rsync → `docker compose build/up` → マイグレーション自動適用。本番 `.env` は SSH で設定（rsync 除外）。

**bun.lock の罠**: lock に `npm.flatt.tech` ミラー URL が混ざると Docker の fresh install が 4xx で落ちる。`bun install` で再混入することがあるので、混ざったら公開 npm に統一する:
```bash
sed -i '' 's#https://npm.flatt.tech/#https://registry.npmjs.org/#g' bun.lock
```
（`bunfig.toml` は公開 npm 固定済み。）

## その他の落とし穴

- Hono `secureHeaders` はデフォルトで `Cross-Origin-Resource-Policy: same-origin`。クロスオリジンで配信する公開エンドポイント（ロゴ等）は secureHeaders **より前** に登録し、明示的に CORP: cross-origin を付ける。
- `noUncheckedIndexedAccess` が有効。配列インデックス/タプル分割代入は `!` かオブジェクト分割で対処。
- MUI アイコンの解決可否は `ls node_modules/@mui/icons-material` では判断できない（bun の hoisting）。`tsc`/`build` で確認する。
