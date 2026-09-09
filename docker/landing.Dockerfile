# やすみ？ ランディングページ（Astro 静的サイト）配信コンテナ
# build: Bun + Astro で dist を生成 / serve: nginx で静的配信

# --- build ---
FROM oven/bun:1 AS build
WORKDIR /app
# workspace の全メンバー package.json を揃えて frozen-lockfile を解決
COPY package.json bun.lock ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
COPY landing/package.json ./landing/
COPY packages/shared/package.json ./packages/shared/
RUN bun install --frozen-lockfile
COPY landing ./landing
RUN bun run --cwd landing build

# --- serve ---
FROM nginx:alpine AS serve
COPY --from=build /app/landing/dist /usr/share/nginx/html
EXPOSE 80
