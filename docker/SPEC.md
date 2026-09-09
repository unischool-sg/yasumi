# やすみ？ Infrastructure / Docker 仕様書

> 本書は [PRD.md](../PRD.md) の §7, §48, §56 を Infra / Docker 観点で具体化したもの。

---

## 1. 目的

`api` / `postgres` の **2 コンテナ構成**で本番運用する。

> ⚠️ PRD §48 は `api` / `scheduler` / `postgres` の 3 コンテナだったが、
> 判定バッチを **API プロセス内 cron（30 分ごと・`app.fetch` 駆動）** に統合したため、
> **別コンテナ `scheduler` は廃止**する（詳細は [backend/CRON.md](../backend/CRON.md)）。

---

## 2. 稼働環境（PRD §8 Infrastructure）

```text
Ubuntu Server
Docker
Docker Compose
Cloudflare Tunnel   … 外部公開（LIFF / LINE Webhook の受け口）
```

- 外部公開は Cloudflare Tunnel 経由。`api` のみ外部から到達可能にする。
- `scheduler` / `postgres` は外部非公開（内部ネットワークのみ）。

---

## 3. コンテナ構成

| サービス | イメージ | コマンド | 公開 | 依存 |
| --- | --- | --- | --- | --- |
| **api** | `build: ../backend` | `node dist/server.js`（cron 同居） | Tunnel 経由で外部 | postgres |
| **postgres** | `postgres:17` | — | 非公開 | — |

`restart: unless-stopped` を全サービスに設定。
判定バッチは api コンテナ内の cron が担う（別コンテナなし）。

### 3.1 環境変数

| 変数 | api | postgres |
| --- | --- | --- |
| `DATABASE_URL` | ✅ | — |
| `LINE_CHANNEL_SECRET` | ✅ | — |
| `LINE_CHANNEL_ACCESS_TOKEN` | ✅ | — |
| `INTERNAL_CRON_TOKEN` | ✅ | — |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | — | ✅ |

Secret は `.env` で管理し、Compose の `${...}` で注入（PRD §54 Secret の環境変数管理）。
`.env` はコミットしない（`.gitignore`）。`.env.example` を用意する。

### 3.2 ボリューム

```text
postgres-data → /var/lib/postgresql/data   … DB 永続化
```

---

## 4. docker-compose 基本形

> PRD §48 では `build: .` だが、本リポジトリは backend を別ディレクトリに
> 置いたため `build: ../backend`（compose 配置に応じたパス）とする。
> また `scheduler` サービスは cron 同居化により削除した。

```yaml
services:
  api:
    build: ../backend
    restart: unless-stopped
    command: [node, dist/server.js]
    environment:
      DATABASE_URL: ${DATABASE_URL}
      LINE_CHANNEL_SECRET: ${LINE_CHANNEL_SECRET}
      LINE_CHANNEL_ACCESS_TOKEN: ${LINE_CHANNEL_ACCESS_TOKEN}
      INTERNAL_CRON_TOKEN: ${INTERNAL_CRON_TOKEN}
    depends_on: [postgres]

  postgres:
    image: postgres:17
    restart: unless-stopped
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: yasumi
    volumes:
      - postgres-data:/var/lib/postgresql/data

volumes:
  postgres-data:
```

---

## 5. Backend イメージ（Dockerfile）方針

`docker/api.Dockerfile`（ベース: **`oven/bun:1`**）。
ビルドコンテキストは**リポジトリルート**（`build.context: ..`）とし、
Bun workspace（`workspace:*` 依存）を解決する。

```text
COPY package.json + 各 workspace の package.json → bun install（レイヤキャッシュ）
COPY ソース一式（tsconfig.base.json / packages / backend）
CMD ["bun", "run", "backend/src/server.ts"]   … API + cron 同居
```

- M0 は「起動して /health が返る」ことが目的の単純構成。ビルド不要（Bun が TS を直接実行）。
- **マルチステージ最適化は M8** で対応（本番向けに軽量化）。
- マイグレーション（Drizzle）は起動時 or 別コマンドで適用する運用を M3 で決める。

---

## 6. Frontend の扱い

LIFF は静的アセットとしてビルド（`vite build`）。配信方法は 2 択:

- **A**: Cloudflare Pages 等の静的ホスティングに配置（Docker 外）
- **B**: `api` コンテナ / 別 nginx コンテナから静的配信

MVP は運用が簡単な方を選ぶ（推奨: A の静的ホスティング）。本書では未確定として記録。

---

## 7. ネットワーク / 公開ポリシー

```text
インターネット
   │  (Cloudflare Tunnel)
   ▼
 api（+ cron 同居）── postgres（内部のみ）
```

- `api` のみ Tunnel で公開。LINE Webhook (`POST /api/webhooks/line`) と LIFF API の受け口。
- `/api/internal/*`（cron の内部エンドポイント）は Tunnel で公開せず、
  内部トークン (`INTERNAL_CRON_TOKEN`) でも二重に保護する。
- `postgres` はホストにポート公開しない（Compose 内部ネットワークのみ）。

---

## 8. 運用メモ

- **ログ**: 各コンテナ標準出力 → Docker ログ。
- **バックアップ**: `postgres-data` ボリュームを定期バックアップ。
- **cron の冪等性**: 再起動しても UNIQUE 制約で判定/通知は重複しない（PRD §35, §36）。
- **Makefile**: `make up` / `make down` / `make logs` / `make migrate` 等のショートカットを整備予定。
