# やすみ？

学校ごとの気象警報ルールから **「今日、学校へ行く必要があるか」** を自動判定し、
LINE で通知する LINE ミニアプリ / LIFF サービス。

> 目的は警報を通知することではなく、**朝、学校へ行くべきかを考えなくてよくすること**。
> 詳細は [PRD.md](./PRD.md) を参照。

## 構成（モノレポ / Bun workspace）

```text
yasumi/
├─ backend/          Hono on Bun（API + プロセス内 cron）      … backend/SPEC.md, backend/CRON.md
├─ frontend/         Vite + React + Tailwind v4 + LIFF          … frontend/SPEC.md
├─ packages/
│  └─ shared/        backend/frontend 共有の型 (@yasumi/shared)
├─ docker/           docker-compose（api + postgres）           … docker/SPEC.md
├─ PRD.md            プロダクト要件定義
└─ ROADMAP.md        開発ロードマップ（M0〜M8）
```

## 前提

- [Bun](https://bun.sh) >= 1.3
- Docker / Docker Compose

## セットアップ

```bash
# 1. 環境変数
cp .env.example .env   # 必要に応じて値を編集

# 2. 依存インストール
make install           # = bun install

# 3a. ローカル開発（backend）
make dev-backend       # http://localhost:3000/health

# 3b. ローカル開発（frontend）
make dev-frontend      # Vite dev server

# 4. Docker で api + postgres を起動
make up
curl localhost:3000/health   # => {"status":"ok"}
make logs
make down
```

## テスト / 型チェック

```bash
make test        # bun test
make typecheck
```

## ドキュメント

| ファイル | 内容 |
| --- | --- |
| [PRD.md](./PRD.md) | プロダクト要件定義 |
| [ROADMAP.md](./ROADMAP.md) | 開発ロードマップ（M0〜M8） |
| [backend/SPEC.md](./backend/SPEC.md) | Backend 仕様 |
| [backend/CRON.md](./backend/CRON.md) | Cron 仕様（30分ごと・同一プロセス・app.fetch） |
| [frontend/SPEC.md](./frontend/SPEC.md) | Frontend 仕様 |
| [docker/SPEC.md](./docker/SPEC.md) | Infra / Docker 仕様 |

現在の進捗: **M0 基盤セットアップ**（ROADMAP 参照）。
