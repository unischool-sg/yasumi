# やすみ？ ランディングページ（Astro 静的サイト）配信コンテナ
# build: Bun + Astro で dist を生成 / serve: nginx で静的配信

# --- build ---
FROM oven/bun:1 AS build
WORKDIR /app
# workspace の全メンバー package.json を揃えて frozen-lockfile を解決
COPY package.json bun.lock bunfig.toml ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
COPY landing/package.json ./landing/
COPY packages/shared/package.json ./packages/shared/
RUN bun install --frozen-lockfile
COPY landing ./landing
# 学校一覧ページが叩く公開API のベースURL（ビルド時に埋め込み）
ARG PUBLIC_API_BASE_URL
ENV PUBLIC_API_BASE_URL=$PUBLIC_API_BASE_URL
# SEO の基準URL（canonical / og:url / sitemap）
ARG PUBLIC_SITE_URL
ENV PUBLIC_SITE_URL=$PUBLIC_SITE_URL
RUN bun run --cwd landing build

# --- serve ---
FROM nginx:alpine AS serve
COPY --from=build /app/landing/dist /usr/share/nginx/html
EXPOSE 80
