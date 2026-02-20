#!/bin/bash
set -e

cd ~/moltworker

echo "=== Step 1: GitHub リポジトリ作成 ==="
gh repo create moltworker --private --source=. --push

echo ""
echo "=== Step 2: GitHub Secrets 設定 ==="
gh secret set CLOUDFLARE_API_TOKEN --body "LjtoMcYBQvsUFN824UEX5d7qNvntkfbliagOS_hZ"
gh secret set CLOUDFLARE_ACCOUNT_ID --body "2f6116da4d8e792a49383a5e340d8a31"

echo ""
echo "=== Step 3: プッシュ（Actions が自動起動） ==="
git add -A
git commit -m "Add GitHub Actions deploy workflow" || true
git push origin main

echo ""
echo "=== 完了！ ==="
echo "GitHub Actions のビルド状況: https://github.com/$(gh repo view --json nameWithOwner -q .nameWithOwner)/actions"
echo ""
echo "数分後にデプロイが完了します。"
