---
description: "moltworker のデプロイ・運用ルール。deploy, restart, debug, lock file, container, gateway に関する作業時に適用。"
alwaysApply: false
globs:
  - "start-openclaw.sh"
  - "scripts/**"
  - "Dockerfile"
  - "wrangler.jsonc"
  - "src/routes/**"
  - "src/gateway/**"
---

# moltworker デプロイ・運用ルール

## MOLT-1: Worker と Container は別ライフサイクル

```
┌─ Cloudflare Worker ──────────────────────────────────────────┐
│  Hono app (src/index.ts)                                     │
│  ├─ publicRoutes   → /api/status, /sandbox-health            │
│  ├─ debugRoutes    → /debug/* (DEV_MODE時のみ)                │
│  ├─ adminRoutes    → /api/admin/* (CF Access認証)             │
│  └─ WebSocket proxy → OpenClaw Gateway へ転送                 │
│                                                              │
│  ┌─ Cloudflare Container (sandbox) ──────────────────────┐   │
│  │  /usr/local/bin/start-openclaw.sh                     │   │
│  │  → R2 復元 → config パッチ → sync-loop → gateway 起動   │   │
│  │                                                       │   │
│  │  openclaw gateway (port 18789)                        │   │
│  │  ├─ Discord WebSocket (ボット)                         │   │
│  │  ├─ AI Gateway → Gemini                               │   │
│  │  └─ Control UI                                        │   │
│  └───────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

- **Worker のデプロイ ≠ Container の再起動**。デプロイ後はコンテナが新イメージで再作成される
- Container は**使い捨て**。永続データは **R2 のみ**（`openclaw-data` バケット）
- cron `*/5 * * * *` がコンテナを起こし続ける

## MOLT-2: デプロイ後の確認手順（この順序を飛ばすな）

```
1. デプロイ完了確認
   → wrangler deploy の出力で Version ID を確認

2. コンテナ起動をトリガー
   → POST /api/admin/gateway/restart
   → 初回リクエストでコンテナが作成される（cold start）

3. 起動待ち（60〜90秒）
   → start-openclaw.sh: R2復元 → config patch → gateway起動
   → /api/status は not_running → not_responding → running と遷移する

4. ステータス確認
   → GET /api/status → {"ok":true,"status":"running"} を確認
   → "not_responding" でも焦るな。Gateway起動に20-30秒かかる

5. ログ確認
   → GET /debug/logs でゲートウェイのログを確認
   → 成功の指標: [discord] logged in to discord as ... (OpenClaw bot)
```

**ステータス遷移の正常フロー:**
```
not_running → (restart トリガー) → not_running → not_responding → running
              ↑ cold start                       ↑ gateway 起動中    ↑ 完了
              約30秒                              約20-30秒
```

## MOLT-3: 絶対にやるな

- ❌ `openclaw gateway restart --force` をコンテナ内（`/debug/cli`）で実行するな
  → リスタートループが壊れてゲートウェイが復帰しなくなる
  → ✅ 代わりに `POST /api/admin/gateway/restart` を使え（Worker側で制御）

## MOLT-4: ロックファイルの正しいパス

OpenClaw は `/tmp/openclaw-<N>/gateway.<hash>.lock` にロックファイルを作成する。

- `start-openclaw.sh` が毎回の再起動前に自動削除している
- 手動クリーンアップ: `rm -f /tmp/openclaw-*/gateway.*.lock`
- **誤ったパス**: `/tmp/openclaw-gateway.lock` や `$CONFIG_DIR/gateway.lock` は不正確。使うな

## MOLT-5: トラブルシュート時のログ確認

1. **stderr を最初に読め** — エラーは stderr に出る
2. **processId を指定してログ取得** — `GET /debug/logs?id=<processId>`
3. **全プロセス一覧で状態把握** — `GET /debug/processes?logs=true`
