COMPOSE = docker compose --env-file .env -f docker/docker-compose.yml

.PHONY: help install dev dev-backend dev-frontend up down logs migrate test typecheck clean

help: ## このヘルプを表示
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

install: ## 依存をインストール (bun install)
	bun install

dev: dev-backend ## 開発起動 (backend)

dev-backend: ## backend を開発起動 (--watch)
	bun run --cwd backend dev

dev-frontend: ## frontend を開発起動 (Vite)
	bun run --cwd frontend dev

up: ## api + postgres コンテナを起動
	$(COMPOSE) up -d --build

down: ## コンテナを停止・削除
	$(COMPOSE) down

logs: ## コンテナのログを表示
	$(COMPOSE) logs -f

migrate: ## DB マイグレーション適用 (M3 で実装予定)
	@echo "migrate: not implemented yet (see ROADMAP M3)"

test: ## テストを実行 (bun test)
	bun test

typecheck: ## 型チェック
	bun run typecheck

clean: ## 生成物を削除
	rm -rf node_modules backend/node_modules frontend/node_modules packages/*/node_modules frontend/dist
