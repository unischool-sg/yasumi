# やすみ？ フロント（LIFF / LINE MINI App）配信コンテナ
# build: Bun + Vite で dist を生成（VITE_* はビルド時に埋め込む） / serve: nginx

# --- build ---
FROM oven/bun:1 AS build
WORKDIR /app
# Vite の環境変数はビルド時に埋め込まれる（クライアントに露出する公開値）
ARG VITE_LIFF_ID
ARG VITE_API_BASE_URL
ARG VITE_LINE_ADD_FRIEND_URL
ENV VITE_LIFF_ID=$VITE_LIFF_ID
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_LINE_ADD_FRIEND_URL=$VITE_LINE_ADD_FRIEND_URL

COPY package.json bun.lock bunfig.toml ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
COPY landing/package.json ./landing/
COPY packages/shared/package.json ./packages/shared/
RUN bun install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages ./packages
COPY frontend ./frontend
RUN bun run --cwd frontend build

# --- serve ---
FROM nginx:alpine AS serve
COPY docker/frontend-nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
