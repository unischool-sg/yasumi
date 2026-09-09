# やすみ？ API コンテナ（Bun / 単一ステージ）
# ビルドコンテキストはリポジトリルート（workspace 解決のため）。
# マルチステージで node_modules をコピーすると Bun の workspace リンク方式により
# 依存を取りこぼすため、install と実行を同一イメージで行う。
FROM oven/bun:1
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# workspace の全メンバー package.json を揃えて frozen-lockfile を解決
COPY package.json bun.lock ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
COPY landing/package.json ./landing/
COPY packages/shared/package.json ./packages/shared/
RUN bun install --frozen-lockfile

# ソース（api の実行に必要なぶん）
COPY tsconfig.base.json ./
COPY packages ./packages
COPY backend ./backend

EXPOSE 3000

# API + プロセス内 cron（backend/CRON.md）。TS を直接実行（ビルド不要）。
CMD ["bun", "run", "backend/src/server.ts"]
