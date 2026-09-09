# やすみ？ デプロイ手順書（M8）

> [ROADMAP.md](./ROADMAP.md) の **M8**（一般公開）に対応。
> PRD §7, §8, §48, §53, §54 を運用観点でまとめる。

---

## 1. 構成（本番）

```text
インターネット
   │  Cloudflare Tunnel（api のみ公開）
   ▼
 api コンテナ（Hono + cron 同居, oven/bun）── postgres:17（内部のみ）
   ▲
   └ LINE Messaging API / 気象庁 へ外向き通信

Frontend(LIFF) … 静的ビルドを Cloudflare Pages 等でホスティング（推奨）
```

- api と cron は同一プロセス（30分ごと・`app.fetch` / [backend/CRON.md](./backend/CRON.md)）。
- 判定・通知は api コンテナ内 cron が実行。別 scheduler コンテナは無し。

---

## 2. 前提サービス設定

### LINE
1. **LINE 公式アカウント**（Messaging API チャネル）を作成。
   - `LINE_CHANNEL_SECRET` / `LINE_CHANNEL_ACCESS_TOKEN` を取得。
   - Webhook URL に `https://<公開ドメイン>/api/webhooks/line` を設定・検証 ON。
2. **LIFF アプリ**（LINE ログインチャネル）を作成。
   - `LIFF_CHANNEL_ID`（IDトークン検証の client_id）を取得。
   - LIFF エンドポイント URL に Frontend の公開 URL を設定 → `VITE_LIFF_ID` を取得。
3. リッチメニュー（今日どう？/学校設定/判定履歴/お知らせ）は任意（§20・将来）。

### Cloudflare Tunnel
- `api` の 3000 番をトンネル経由で `https://<ドメイン>` に公開。
- `postgres` はホスト公開しない（Compose 内部ネットワークのみ）。

---

## 3. 環境変数（`.env`）

`.env.example` をコピーして設定（`.env` はコミットしない / §54）。

| 変数 | 用途 |
| --- | --- |
| `DATABASE_URL` | `postgres://app:<pw>@postgres:5432/yasumi` |
| `POSTGRES_USER/PASSWORD/DB` | postgres コンテナ |
| `LINE_CHANNEL_SECRET` | Webhook 署名検証 |
| `LINE_CHANNEL_ACCESS_TOKEN` | Push 送信 |
| `LIFF_CHANNEL_ID` | IDトークン検証 |
| `INTERNAL_CRON_TOKEN` | cron 内部EPの認可（推測困難な値） |
| `ADMIN_LINE_USER_IDS` | 管理者（学校/ルール編集許可 §23） |
| `API_PORT` / `POSTGRES_PORT` | ホスト公開ポート（既定 3000/5432） |
| `VITE_LIFF_ID` / `VITE_API_BASE_URL` | Frontend ビルド時 |

---

## 4. デプロイ手順

```bash
# 1. 取得・環境変数
git clone <repo> && cd yasumi
cp .env.example .env   # 値を設定

# 2. 起動（api + postgres）
make up

# 3. DB マイグレーション & 初期地域データ
make migrate
make seed

# 4. 動作確認
curl https://<ドメイン>/health   # {"status":"ok"}

# 5. Frontend（LIFF）ビルド & ホスティング
VITE_LIFF_ID=<liff-id> VITE_API_BASE_URL=https://<ドメイン> bun run --cwd frontend build
#   → frontend/dist を Cloudflare Pages 等へデプロイ
```

- api コンテナ起動時点で cron が動き出す（`INTERNAL_CRON_TOKEN` 必須）。
- ログ: `make logs`。停止: `make down`。

---

## 5. Frontend ホスティング方針（docker/SPEC.md §6 の確定）

- **採用: Cloudflare Pages 等の静的ホスティング（Docker 外）**。
  - 理由: LIFF は静的アセット。CDN 配信が簡単・安価で、api コンテナを軽く保てる。
  - `VITE_API_BASE_URL` に api の公開ドメインを設定してビルド。
- 代替（自前配信が必要な場合）: nginx コンテナを compose に追加して `frontend/dist` を配信。

---

## 6. 免責表示（PRD §53）

- Frontend フッターに常設済み（「本サービスは学校公式ではありません…」）。
- 通知文面にも免責を付与（§18, §52）。

---

## 7. 運用

- **バックアップ**: `postgres-data` ボリュームを定期バックアップ。
- **冪等性**: cron 再起動・重複発火でも UNIQUE 制約で判定/通知は重複しない（§35/§36）。
- **監視**: `/health`、`make logs` の run-check サマリ（status/checksCreated/notificationsSent）。
- **地域追加**: `seed-areas.ts` に対象地域（気象庁 class20s コード）を追記し `make seed`。

---

## 8. 本番イメージ

- `docker/api.Dockerfile`: `oven/bun` の 2 ステージ（deps 導入 → runtime）。
  `bun install --production` で devDeps を除外。TS を `bun run` で直接実行（ビルド不要）。
- マイグレーションは `make migrate`（api コンテナ内で `migrate.ts` 実行）。

---

## 9. 残课題 / 将来（PRD §60）

- 管理者承認・編集提案フロー、Flex Message、複数学校切替、通知時間設定。
- Web Push / Discord / Email（`NotificationProvider` 追加のみで対応可能）。
- 警報解除・特別警報即休校・交通機関（`RuleCondition` 拡張）。
