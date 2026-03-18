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
├── restore-from-r2.sh     # R2 → local restore via rclone
├── patch-config.js        # Runtime config patching (gateway, channels, models)
└── sync-loop.sh           # Background R2 sync (30s interval)

start-openclaw.sh          # Main orchestrator (calls scripts/*, launches gateway)
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

`start-openclaw.sh` orchestrates 6 phases:

1. **Restore** (`scripts/restore-from-r2.sh`) — rclone で R2 → local にリストア
2. **Clean** — `agents/main/agent/auth-profiles.json` 等の stale state を削除
3. **Onboard** — 初回のみ `openclaw onboard --non-interactive` を実行
4. **Patch** (`scripts/patch-config.js`) — gateway, channels, models をランタイム設定で上書き
5. **Sync** (`scripts/sync-loop.sh`) — バックグラウンド R2 同期開始
6. **Launch** — `openclaw gateway --port 18789` で起動

## R2 Storage

バケット名: **`openclaw-data`** (wrangler.jsonc, config.ts, start-openclaw.sh で統一)

| R2 パス | コンテナ内パス |
|---|---|
| `openclaw-data/openclaw/` | `/root/.openclaw/` |
| `openclaw-data/workspace/` | `/root/clawd/` |
| `openclaw-data/skills/` | `/root/clawd/skills/` |

**注意**: R2 の同期ループがパッチ済み config を R2 に書き戻すため、R2 のファイルが古い場合はパッチの効果が打ち消される可能性がある。R2 上のファイルを直接修正する場合は `wrangler r2 object put` を使う。

## Commands

```bash
npm test              # Run tests (vitest)
npm run test:watch    # Run tests in watch mode
npm run build         # Build worker + client
npm run deploy        # Build and deploy to Cloudflare
npm run dev           # Vite dev server
npm run start         # wrangler dev (local worker)
npm run typecheck     # TypeScript check
```

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

## OpenClaw Config Gotchas

- `agents.defaults.model` must be `{ "primary": "provider/model" }` not a string
- `gateway.mode` must be `"local"` for headless operation
- `dmPolicy: "open"` **requires** `allowFrom: ["*"]` — config validation will reject without it
- No `webchat` channel — the Control UI is served automatically
- `gateway.bind` is not a config option — use `--bind` CLI flag

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
