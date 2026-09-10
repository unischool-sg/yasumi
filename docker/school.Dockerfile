# やすみ？ 先生ダッシュボード（MUI + TanStack SPA）配信コンテナ
# build: Bun + Vite で dist 生成 / serve: nginx（admin.Dockerfile と同型）

FROM oven/bun:1 AS build
WORKDIR /app
ARG VITE_SCHOOL_API_BASE_URL
ENV VITE_SCHOOL_API_BASE_URL=$VITE_SCHOOL_API_BASE_URL

COPY package.json bun.lock bunfig.toml ./
COPY school/package.json ./school/
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
COPY landing/package.json ./landing/
COPY packages/shared/package.json ./packages/shared/
RUN bun install --frozen-lockfile

COPY tsconfig.base.json ./
COPY school ./school
RUN bun run --cwd school build

FROM nginx:alpine AS serve
COPY docker/frontend-nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/school/dist /usr/share/nginx/html
EXPOSE 80
