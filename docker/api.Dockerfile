# やすみ？ API コンテナ（Bun / 本番向け 2 ステージ）
# ビルドコンテキストはリポジトリルート（workspace 解決のため）。

# --- deps: 依存インストール（本番のみ） ---
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
COPY packages/shared/package.json ./packages/shared/
RUN bun install --frozen-lockfile --production

# --- runtime: ソース + 本番依存 ---
FROM oven/bun:1 AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=deps /app/node_modules ./node_modules
COPY tsconfig.base.json ./
COPY packages ./packages
COPY backend ./backend

EXPOSE 3000

# API + プロセス内 cron（backend/CRON.md）。TS を直接実行（ビルド不要）。
CMD ["bun", "run", "backend/src/server.ts"]
