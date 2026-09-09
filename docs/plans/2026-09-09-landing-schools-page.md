# Landing「登録済み学校一覧」ページ

## 背景 / 目的
やすみ？の landing に、現在登録されている学校の一覧を見せるページ `/schools` を追加する。
「自分の学校が既にあるか」を友だち追加前に確認でき、掲載数=盛り上がりの証明にもなる（マネタイズ前の
ユーザー獲得を後押し）。学校名・都道府県・市区町村・公式サイトは公開情報なので、認証不要で見せてよい。

## 方針
- landing は Astro 静的サイト（nginx 配信）。ビルド時に API へ繋ぐのは脆いので、**クライアントサイドで
  公開APIを fetch** して描画する（常に最新・静的のまま）。
- API ドメインはリポジトリにハードコードせず、既存 frontend/admin と同じく **docker build 時に env 注入**
  （`PUBLIC_API_BASE_URL`）。`.env.example` に既に API ドメインがあるので同パターン。

## 1. バックエンド（公開エンドポイント）
- `backend/src/infrastructure/db/repositories/schools.ts`
  - `listPublicSchools(db)` を追加。**公開安全な列のみ** select（id, name, prefecture, city, websiteUrl）。
    `createdBy` 等の PII は返さない。都道府県→学校名の昇順。
- `backend/src/api/app.ts`
  - 認証グループ `api` の**前**（webhook/cron と同じ無認証帯）に `app.get("/public/schools", ...)` を追加。
- `backend/src/api/app.test.ts`
  - 認証なしで 200・作成校を含む・`createdBy` を含まない、を検証（DB-gated）。

## 2. landing（Astro）
- 共有化のため header/footer をコンポーネント抽出:
  - `landing/src/consts.ts` … `LINE_URL` と `API_BASE = import.meta.env.PUBLIC_API_BASE_URL`。
  - `landing/src/components/Header.astro` … 既存ヘッダ + nav に「学校一覧」(`/schools`) を追加。アンカーは
    `/#features` 等の絶対指定で /schools からも機能させる。
  - `landing/src/components/Footer.astro` … 既存フッタ（クレジット含む）をそのまま移設。
  - `landing/src/pages/index.astro` … header/footer を上記コンポーネントに置換、LINE_URL は consts から import。
- `landing/src/pages/schools.astro`（新規）:
  - Header / Footer 共有。ヒーロー見出し + ライブ件数。クライアント側フィルタ（検索）。
  - 都道府県ごとにグルーピングしてカード表示。website があればリンク。
  - loading / 空 / エラー状態。末尾に LINE 友だち追加 CTA。
  - `<script>` で `${API_BASE}/public/schools` を fetch し DOM 構築。
- `landing/src/env.d.ts` … `PUBLIC_API_BASE_URL` の型。

## 3. Docker / 環境変数
- `docker/landing.Dockerfile` … build ステージに `ARG PUBLIC_API_BASE_URL` + `ENV` を追加（build 前）。
- `docker/docker-compose.yml` … landing サービスに `build.args.PUBLIC_API_BASE_URL`。
- `.env.example` … `PUBLIC_API_BASE_URL=https://yasumi-api.unischool.jp` を landing 節に追加。

## 4. 検証
- backend: `bun run typecheck` / `bun test`（新テストは TEST_DATABASE_URL 時のみ）。
- landing: `bun run --cwd landing build` 成功。dist に `/schools` が生成される。
- 手元では `PUBLIC_API_BASE_URL` 未設定→エラー状態が出る（graceful）。

## スコープ外
- ページング/無限スクロール（件数が増えたら別途）。購読数などの統計表示（PII/集計は別途）。
- 本番デプロイ（product への PR マージ）は**ユーザーの明示承認が必要**。実装・commit まで。
