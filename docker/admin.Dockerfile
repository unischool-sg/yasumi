# やすみ？ 管理画面（MUI + TanStack SPA）配信コンテナ
# build: Bun + Vite で dist 生成 / serve: nginx

FROM oven/bun:1 AS build
WORKDIR /app
ARG VITE_ADMIN_API_BASE_URL
ENV VITE_ADMIN_API_BASE_URL=$VITE_ADMIN_API_BASE_URL

COPY package.json bun.lock bunfig.toml ./
COPY admin/package.json ./admin/
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
COPY landing/package.json ./landing/
COPY packages/shared/package.json ./packages/shared/
RUN bun install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages ./packages
COPY admin ./admin
RUN bun run --cwd admin build

FROM nginx:alpine AS serve
COPY docker/frontend-nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/admin/dist /usr/share/nginx/html
EXPOSE 80
