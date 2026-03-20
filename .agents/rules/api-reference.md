---
description: "moltworker の全 API エンドポイントと OpenClaw 設定の一覧。debug, api, admin, endpoint, url, config, patch に関する作業時に参照。"
alwaysApply: false
globs:
  - "src/routes/**"
  - "scripts/patch-config.js"
  - "src/gateway/env.ts"
---

# moltworker API・設定リファレンス

## デバッグ URL 一覧

Base: `https://moltbot-sandbox.yasuhiko-kohata.workers.dev`

### Public（認証不要）
| メソッド | パス | 用途 |
|---------|------|------|
| GET | `/api/status` | ゲートウェイ稼働状態（`running` / `not_running` / `not_responding`） |
| GET | `/sandbox-health` | Worker 自体のヘルスチェック |

### Debug（DEV_MODE 時のみ）
| メソッド | パス | 用途 |
|---------|------|------|
| GET | `/debug/logs` | 最新プロセスのログ（`?id=<pid>` で指定可） |
| GET | `/debug/processes` | 全プロセス一覧（`?logs=true` でログ付き） |
| GET | `/debug/cli` | コンテナ内コマンド実行（`?cmd=<URL-encoded>`） |
| GET | `/debug/gateway-api` | Gateway API プロキシ（`?path=/`） |
| GET | `/debug/container-config` | OpenClaw 設定 JSON 全体 |
| GET | `/debug/env` | 環境変数（キーの有無のみ） |
| GET | `/debug/version` | OpenClaw / Node.js バージョン |
| GET | `/debug/ws-test` | WebSocket デバッグ UI（ブラウザで開く） |

### Admin（CF Access 認証）
| メソッド | パス | 用途 |
|---------|------|------|
| POST | `/api/admin/gateway/restart` | ゲートウェイ再起動（**推奨方法**） |
| POST | `/api/admin/storage/sync` | R2 手動同期 |
| GET | `/api/admin/storage` | R2 ストレージ状態・最終同期時刻 |
| GET | `/api/admin/devices` | デバイス一覧（pending/paired） |
| POST | `/api/admin/devices/:id/approve` | デバイス承認 |
| POST | `/api/admin/devices/approve-all` | 全デバイス一括承認 |

## OpenClaw 設定（`scripts/patch-config.js`）

起動時にパッチされる設定項目:

| 設定パス | 値 | 説明 |
|----------|-----|------|
| `gateway.port` | `18789` | リッスンポート |
| `gateway.mode` | `local` | ローカルモード |
| `gateway.bind` | `lan` | LAN バインド |
| `gateway.auth.token` | env | トークン認証 |
| `commands.native` | `true` | コマンド自動承認（Discord用。`auto` だと Discord で承認タイムアウトする） |
| `channels.discord.groupPolicy` | `open` | ギルドメッセージ許可 |
| `channels.discord.dmPolicy` | env | DM ポリシー |
| `channels.discord.guilds` | record 形式 | `{ "guildId": { channels: { "*": {} } } }` |
| `agents.defaults.model.primary` | env | AI モデル（`google/gemini-3.1-flash-lite-preview`） |
| `models.providers.google` | env | AI Gateway 経由のプロバイダ設定 |

### 登録済みギルド
| ID | 名前 |
|----|------|
| `1455869574355619934` | K's Classic |
| `1075560600878448680` | みらい創造舎・E-spiral |

### エージェントバインド
| ギルド | エージェント |
|--------|------------|
| K's Classic | `main`（デフォルト） |
| みらい創造舎・E-spiral | `e-spiral` |
