# Landing Page SEO 強化

## 背景 / 目的
ユーザーが OGP 画像（`landing/public/ogp.png` 1200x630 / `ogp.svg`）を用意済み。landing の SEO を本格化し、
検索流入と SNS シェア時の見栄えを最大化する。現状 `astro.config` の `site` はプレースホルダ、head の
メタは最小限（canonical / og:image / twitter / 構造化データ / favicon / sitemap / robots が未整備）。

## 基準ドメイン
- 本番: `https://yasumi.unischool.jp`（ユーザー確認済み）。
- リポジトリ側はハードコードせず **`PUBLIC_SITE_URL` env で上書き可能**にし、デフォルトを上記に。
  docker build 時に注入（API ベースと同パターン）。

## 実装
### 1. astro.config.mjs
- `site: process.env.PUBLIC_SITE_URL || "https://yasumi.unischool.jp"`。
- `@astrojs/sitemap` を integrations に追加（全ページを走査し `sitemap-index.xml` 生成）。

### 2. Layout.astro（head 全面強化）
- Props 追加: `image`（既定 `/ogp.png`）, `type`（既定 website）, `noindex`。
- canonical: `new URL(Astro.url.pathname, Astro.site)`。
- robots meta（noindex 切替）。
- OGP: `og:url / og:site_name / og:locale(ja_JP) / og:type / og:image(絶対URL) / og:image:width(1200)
  / og:image:height(630) / og:image:alt`。
- Twitter: `summary_large_image / title / description / image`。
- favicon: `/favicon.svg`（新規作成）+ apple-touch-icon（ogp流用は避け専用）。
- 構造化データ（JSON-LD）: `Organization` + `WebSite` を全ページ。
- head 用の名前付き slot（`<slot name="head" />`）を追加し、ページ個別の JSON-LD を注入可能に。

### 3. ページ個別
- index.astro: canonical `/`、FAQ を `FAQPage` JSON-LD で構造化（リッチリザルト狙い）。
- schools.astro: canonical `/schools`、`BreadcrumbList` JSON-LD。

### 4. 静的アセット / 生成物
- `landing/public/robots.txt`: 全許可 + `Sitemap: https://yasumi.unischool.jp/sitemap-index.xml`。
- `landing/public/favicon.svg`: ブランド favicon（新規）。

### 5. Docker / env
- `docker/landing.Dockerfile`: `ARG PUBLIC_SITE_URL` + `ENV`（build 前）。
- `docker/docker-compose.yml`: landing に `build.args.PUBLIC_SITE_URL`。
- `.env.example`: `PUBLIC_SITE_URL=https://yasumi.unischool.jp`。

## 検証
- `bun run --cwd landing build` 成功、`dist/sitemap-index.xml` / `sitemap-0.xml` 生成。
- index/schools の head に canonical・og:image 絶対URL・twitter・JSON-LD が出力される。
- `robots.txt` に Sitemap 行。`astro check`（typecheck）通過。

## スコープ外
- 動的 OGP 生成（ページごとの画像）。多言語 hreflang。本番デプロイ（要ユーザー明示承認）。
