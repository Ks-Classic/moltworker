# Agent Instructions

Guidelines for AI agents working on this codebase.

## Project Overview

This is a Cloudflare Worker that runs [OpenClaw](https://github.com/openclaw/openclaw) in a Cloudflare Sandbox container. It provides:
- Proxying to the OpenClaw gateway (web UI + WebSocket)
- Admin UI at `/_admin/` for device management
- API endpoints at `/api/*` for device pairing
- Debug endpoints at `/debug/*` for troubleshooting

## Project Structure

```
src/
├── index.ts          # Main Hono app, route mounting
├── types.ts          # TypeScript type definitions
├── config.ts         # Constants (ports, timeouts, paths)
├── auth/             # Cloudflare Access authentication
│   ├── jwt.ts        # JWT verification
│   ├── jwks.ts       # JWKS fetching and caching
│   └── middleware.ts # Hono middleware for auth
├── gateway/          # OpenClaw gateway management
│   ├── process.ts    # Process lifecycle (find, start)
│   ├── env.ts        # Environment variable building
│   ├── r2.ts         # R2 bucket mounting
│   ├── sync.ts       # R2 backup sync logic
│   └── utils.ts      # Shared utilities (waitForProcess)
├── routes/           # API route handlers
│   ├── api.ts        # /api/* endpoints (devices, gateway)
│   ├── admin.ts      # /_admin/* static file serving
│   ├── debug.ts      # /debug/* endpoints
│   └── public.ts     # Unauthenticated routes (/sandbox-health, /api/status)
└── client/           # React admin UI (Vite)
    ├── App.tsx
    ├── api.ts        # API client
    └── pages/

scripts/                    # Container startup scripts (copied to /usr/local/lib/openclaw/)
├── bootstrap-openclaw.sh  # Restore/config/bootstrap phases before gateway launch
├── restore-from-r2.sh     # R2 → local restore via rclone
├── patch-config.cjs       # Runtime config patching (gateway, channels, models)
├── run-openclaw-gateway.sh # Gateway supervision + restart loop
└── sync-loop.sh           # Background R2 sync (30s interval)

start-openclaw.sh          # Thin orchestrator (bootstrap + gateway supervisor)
Dockerfile                 # Container image (Node 22 + OpenClaw + rclone)
wrangler.jsonc             # Cloudflare Worker + Container + R2 configuration
```

## Architecture

```
Browser / Discord
       │
       ▼
┌─────────────────────────────────────┐
│     Cloudflare Worker (index.ts)    │
│  - Proxies HTTP/WebSocket requests  │
│  - CF Access authentication         │
│  - Admin UI serving                 │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│     Cloudflare Sandbox Container    │
│  ┌───────────────────────────────┐  │
│  │     OpenClaw Gateway          │  │
│  │  - Control UI on port 18789   │  │
│  │  - WebSocket RPC protocol     │  │
│  │  - Agent runtime              │  │
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │     R2 Sync (rclone)          │  │
│  │  - 30s interval background    │  │
│  │  - Bucket: openclaw-data      │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

## Container Startup Flow

`start-openclaw.sh` now delegates to two focused scripts:

1. **Bootstrap** (`scripts/bootstrap-openclaw.sh`)
2. **Gateway Supervision** (`scripts/run-openclaw-gateway.sh`)

`scripts/bootstrap-openclaw.sh` executes these phases:

1. **Restore** (`scripts/restore-from-r2.sh`) — rclone で R2 → local にリストア
2. **Clean** — `agents/main/agent/auth-profiles.json` 等の stale state を削除
3. **Onboard** — 初回のみ `openclaw onboard --non-interactive` を実行
4. **Build** (`scripts/build-openclaw-config.cjs`) — source + overrides から effective config を生成
5. **Patch** (`scripts/patch-config.cjs`) — gateway, channels, models をランタイム設定で上書き
6. **Doctor** (`openclaw doctor --fix`) — 壊れた config/state を自動修復
7. **Sync** (`scripts/sync-loop.sh`) — バックグラウンド R2 同期開始
8. **Security Monitor** (`scripts/security-monitor.sh`) — セキュリティ監視 daemon を起動

`scripts/run-openclaw-gateway.sh` handles:

1. **Launch** — `openclaw gateway --port 18789` で起動
2. **Supervision** — lock cleanup, signal handling, restart loop

## R2 Storage

バケット名: **`openclaw-data`** (wrangler.jsonc, config.ts, start-openclaw.sh で統一)

| R2 パス | コンテナ内パス |
|---|---|
| `openclaw-data/openclaw/` | `/root/.openclaw/` |
| `openclaw-data/workspace/` | `/root/clawd/` |
| `openclaw-data/skills/` | `/root/clawd/skills/` |

**重要**:
- `config/openclaw.source.json` が baseline の宣言的設定
- `/root/.openclaw/openclaw.overrides.json` が runtime override の正本
- `openclaw/openclaw.json` は source + overrides から生成される生成物。手で直接編集しない
- `npm run config:build` で baseline source から生成し、deploy workflow は `openclaw.json` と `openclaw.source.json` を R2 へ反映する
- `scripts/sync-loop.sh` と `/api/admin/storage/sync` は `openclaw.json` を R2 へ書き戻さない。source / overrides / state だけが sync 対象

## Commands

```bash
npm run config:build  # Build openclaw/openclaw.json from config/openclaw.source.json
npm run config:check  # Verify generated config is up to date
npm test              # Run tests (vitest)
npm run test:watch    # Run tests in watch mode
npm run build         # Build worker + client
npm run deploy        # 🚫 DO NOT USE LOCALLY (exec format error on ARM). Use GitHub Actions.
npm run dev           # Vite dev server
npm run start         # wrangler dev (local worker)
npm run typecheck     # TypeScript check
```

## Deployment Rules (CRITICAL)

1. **DO NOT DEPLOY LOCALLY via `npm run deploy`**
   - The Cloudflare Sandbox container requires a `linux/amd64` architecture. Running deployments locally on an ARM64 machine (e.g. M1/M2/M3 Mac, aarch64 Linux) will cause Docker to throw an `exec format error` and crash the build.
   - **ALWAYS** commit and push your changes to GitHub (`git commit` -> `git push`), and allow the GitHub Actions workflow (`.github/workflows/deploy.yml`) to deploy it from an `amd64` environment.

## Testing

Tests use Vitest. Test files are colocated with source files (`*.test.ts`).
When adding new functionality, add corresponding tests.

## Environment Variables

### Worker Environment (wrangler secrets)

| Variable | Purpose | Required |
|---|---|---|
| `GEMINI_API_KEY` | Gemini API key | ✅ |
| `CLOUDFLARE_AI_GATEWAY_API_KEY` | AI Gateway API key | ✅ |
| `CF_AI_GATEWAY_ACCOUNT_ID` | AI Gateway account ID | ✅ |
| `CF_AI_GATEWAY_GATEWAY_ID` | AI Gateway gateway ID | ✅ |
| `CF_AI_GATEWAY_MODEL` | Model spec (e.g. `google-ai-studio/gemini-3.1-flash-lite-preview`) | ✅ |
| `MOLTBOT_GATEWAY_TOKEN` | Gateway auth token | ✅ |
| `DISCORD_BOT_TOKEN` | Discord bot token | ✅ |
| `DISCORD_DM_POLICY` | `open` or `pairing` | ✅ |
| `LARK_APP_ID` | Lark app ID for later business integration | Optional |
| `LARK_APP_SECRET` | Lark app secret for later business integration | Optional |
| `LARK_BASE_TOKEN` | Lark Base app token | Optional |
| `LARK_TABLE_ID` | Lark Base table ID | Optional |
| `CF_ACCOUNT_ID` | Cloudflare account ID | ✅ |
| `R2_ACCESS_KEY_ID` | R2 access key | ✅ |
| `R2_SECRET_ACCESS_KEY` | R2 secret key | ✅ |
| `DEV_MODE` | `true` skips CF Access auth | Optional |
| `DEBUG_ROUTES` | `true` enables `/debug/*` | Optional |

### Container Environment (mapped in gateway/env.ts)

| Worker Var | Container Var | Notes |
|---|---|---|
| `MOLTBOT_GATEWAY_TOKEN` | `OPENCLAW_GATEWAY_TOKEN` | Gateway `--token` flag |
| `DEV_MODE` | `OPENCLAW_DEV_MODE` | `controlUi.allowInsecureAuth` |
| `DISCORD_BOT_TOKEN` | `DISCORD_BOT_TOKEN` | Passed through |
| `LARK_APP_ID` | `LARK_APP_ID` | Passed through for future OpenClaw-side Lark integration |
| `LARK_APP_SECRET` | `LARK_APP_SECRET` | Passed through for future OpenClaw-side Lark integration |
| `LARK_BASE_TOKEN` | `LARK_BASE_TOKEN` | Passed through for future OpenClaw-side Lark integration |
| `LARK_TABLE_ID` | `LARK_TABLE_ID` | Passed through for future OpenClaw-side Lark integration |

## OpenClaw Config Gotchas

- `agents.defaults.model` must be `{ "primary": "provider/model" }` not a string
- `gateway.mode` must be `"local"` for headless operation
- `dmPolicy: "open"` **requires** `allowFrom: ["*"]` — config validation will reject without it
- No `webchat` channel — the Control UI is served automatically
- `gateway.bind` is not a config option — use `--bind` CLI flag

## OpenClaw 既知バグと回避策

### Discord 2009 Unauthorized — 2つの根本原因

Discordで `{"success":false,"error":[{"code":2009,"message":"Unauthorized"}]}` が出る場合、以下の2つの原因が重なることがある。

#### 原因1: `channels.discord.presence` キー（レガシー残留）

- OpenClaw 2026.4.x は `channels.discord.presence` を未知キーとして拒否する
- GitHub issue #3464 で提案されたが **"closed as not planned"** — 実装されなかった
- 古い R2 バックアップや手動編集で config に残留することがある
- **対処**: `scripts/patch-config.cjs` の `sanitizeDiscordChannelConfig()` が起動時に自動削除する

#### 原因2: `execApprovals` handler の gateway token 欠落（OpenClaw Issue #4944）

- `DiscordExecApprovalHandler` が `GatewayClient` を生成する際に gateway token を渡さない
- exec approval イベントが発生するたびに gateway への WebSocket 接続が 2009 で失敗する
- OpenClaw 側は **"closed as not planned"** — 上流修正なし
- **対処**: `channels.discord.execApprovals: false` を設定して handler を無効化
  - `commands.native: true` が既に設定されているため exec 承認は自動通過し機能損失なし
  - `scripts/patch-config.cjs` の `patchChannels()` で常に設定される

#### 診断コマンド

```bash
# コンテナ内ログで原因を切り分ける
# stderr を最初に読む（stdout ではなく）
GET /debug/logs → stderr セクションを確認

# "presence" エラーの有無を確認
stderr: "channels.discord: Unrecognized key: \"presence\""

# execApprovals エラーの有無を確認
stderr: "discord exec approvals: connect error: unauthorized: gateway token missing"
```

## Per-Agent Model Configuration

`CF_AI_GATEWAY_MODEL` は `agents.defaults.model.primary`（全エージェントのフォールバック）として設定される。
エージェントごとに別モデルを使いたい場合は `config/openclaw.source.json` の `agents.list` に `model` を追加するだけでよい。

```json
{
  "agents": {
    "list": [
      {
        "id": "koh",
        "name": "Koh",
        "workspace": "/root/clawd",
        "model": { "primary": "google/gemini-2.5-pro" }
      },
      {
        "id": "e-spiral",
        "name": "E-SPIRAL",
        "model": { "primary": "google/gemini-2.5-flash-lite" }
      }
    ]
  }
}
```

**注意**: per-agent で指定するモデルは `models.providers` に設定済みのプロバイダーを参照すること。
CF AI Gateway 経由のプロバイダー名は `patch-config.cjs` の `patchAIGatewayModel()` で確認できる（例: `google`, `anthropic`）。

## Key Patterns

### CLI Commands
When calling the OpenClaw CLI from the worker, always include `--url ws://localhost:18789`:
```typescript
sandbox.startProcess('openclaw devices list --json --url ws://localhost:18789')
```

### Success Detection
The CLI outputs "Approved" (capital A). Use case-insensitive checks:
```typescript
stdout.toLowerCase().includes('approved')
```

## Code Style

- TypeScript strict mode
- Prefer explicit types over inference for function signatures
- Keep route handlers thin — extract logic to separate modules
- Use Hono's context methods (`c.json()`, `c.html()`) for responses

## Common Tasks

### Adding a New API Endpoint
1. Add route handler in `src/routes/api.ts`
2. Add types if needed in `src/types.ts`
3. Update client API in `src/client/api.ts` if frontend needs it
4. Add tests

### Adding a New Environment Variable
1. Add to `MoltbotEnv` interface in `src/types.ts`
2. If passed to container, add to `buildEnvVars()` in `src/gateway/env.ts`
3. Update `.dev.vars.example`

### Debugging
```bash
npx wrangler tail              # View live logs
npx wrangler secret list       # Check secrets
```
Enable debug routes with `DEBUG_ROUTES=true` and check `/debug/processes?logs=true`.

**★ トラブルシュートの鉄則**: `/debug/logs` の **stderr を最初に読め**。stdout ではなくstderr にエラーが出る。
