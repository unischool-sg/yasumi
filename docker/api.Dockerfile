# やすみ？ API コンテナ（Bun / M0 開発向け単純構成）
# ビルドコンテキストはリポジトリルート（workspace 解決のため）。
# マルチステージ最適化は M8 で対応する。
FROM oven/bun:1

WORKDIR /app

# 依存解決に必要な package.json を先にコピー（レイヤキャッシュ活用）
COPY package.json bun.lock* ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
COPY packages/shared/package.json ./packages/shared/

RUN bun install --frozen-lockfile || bun install

# ソース一式をコピー
COPY tsconfig.base.json ./
COPY packages ./packages
COPY backend ./backend

ENV PORT=3000
EXPOSE 3000

CMD ["bun", "run", "backend/src/server.ts"]
