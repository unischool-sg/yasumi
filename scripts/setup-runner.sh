#!/usr/bin/env bash
# self-hosted GitHub Actions runner をサーバーに設置する（DEPLOY.md §9.1）。
# 使い方: REG_TOKEN=<登録トークン> bash setup-runner.sh
set -euo pipefail

REPO_URL="https://github.com/unischool-sg/yasumi"
: "${REG_TOKEN:?登録トークンを REG_TOKEN=... で渡してください}"

# アーキテクチャ判定
case "$(uname -m)" in
  x86_64|amd64) ARCH=x64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) echo "未対応のアーキテクチャ: $(uname -m)"; exit 1 ;;
esac

# docker を sudo なしで使えるようにする
if ! docker ps >/dev/null 2>&1; then
  echo "[setup] docker グループに $USER を追加します"
  sudo usermod -aG docker "$USER" || true
fi

mkdir -p ~/actions-runner && cd ~/actions-runner

if [ ! -f ./config.sh ]; then
  V=$(curl -s https://api.github.com/repos/actions/runner/releases/latest | grep -oP '"tag_name": "v\K[^"]+')
  echo "[setup] runner v${V} (${ARCH}) を取得"
  curl -o runner.tar.gz -L "https://github.com/actions/runner/releases/download/v${V}/actions-runner-linux-${ARCH}-${V}.tar.gz"
  tar xzf runner.tar.gz && rm -f runner.tar.gz
fi

echo "[setup] runner を登録（ラベル: unischool）"
./config.sh --url "$REPO_URL" --token "$REG_TOKEN" --labels unischool --name unischool --unattended --replace

echo "[setup] サービス化して起動"
sudo ./svc.sh install
sudo ./svc.sh start
sudo ./svc.sh status || true

echo "[setup] 完了。GitHub → Settings → Actions → Runners で Online を確認してください。"
