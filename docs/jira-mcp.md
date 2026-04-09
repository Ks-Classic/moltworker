# Jira MCP Integration

このリポジトリでは、Jira 連携は Worker に REST API を追加するのではなく、OpenClaw の `mcp.servers.jira` として注入する。
理由は次の通りです。

- 既存アーキテクチャは `openclaw.source.json` + `patch-config.cjs` で runtime 設定を組み立てる方式
- OpenClaw 公式 docs で `mcp.servers` の保存形式がサポートされている
- Jira 専用ロジックを Worker route に増やさず、OpenClaw/Codex の両方で同じ MCP サーバーを使える

## 1. OpenClaw 側の設定

`start-openclaw.sh` 実行時に `scripts/patch-config.cjs` が以下の env を見て `mcp.servers.jira` を生成する。

### Remote MCP

```bash
JIRA_MCP_URL=https://jira-mcp.example.com/sse
JIRA_MCP_TRANSPORT=streamable-http
JIRA_MCP_AUTH_TOKEN=your-bearer-token
# Optional:
# JIRA_MCP_HEADERS_JSON={"X-Workspace":"sales"}
# JIRA_MCP_CONNECTION_TIMEOUT_MS=15000
```

`JIRA_MCP_TRANSPORT` は未指定時 `sse` 扱い。`streamable-http` のみ明示設定する。

### Stdio MCP

```bash
JIRA_MCP_COMMAND=npx
JIRA_MCP_ARGS_JSON=["-y","<your-jira-mcp-package>"]
JIRA_MCP_CWD=/root/clawd

# Common Jira credentials passed to the stdio child:
JIRA_BASE_URL=https://your-site.atlassian.net
JIRA_EMAIL=you@example.com
JIRA_API_TOKEN=your-jira-api-token

# Optional extra env for the child process:
JIRA_MCP_ENV_JSON={"JIRA_PROJECT_KEY":"OPS"}
```

注意:

- `JIRA_MCP_COMMAND` / `JIRA_MCP_ARGS_JSON` の実値は、あなたが現在ローカルで動かしている Jira MCP サーバーに合わせる
- package 名や CLI 名はこの repo では決め打ちしていない
- `JIRA_API_TOKEN` は Atlassian の API token を使う

## 2. Local dev / Worker secrets

ローカル開発は `.dev.vars`、本番は `wrangler secret put` で設定する。

例:

```bash
npx wrangler secret put JIRA_MCP_URL
npx wrangler secret put JIRA_MCP_AUTH_TOKEN
```

または stdio の場合:

```bash
npx wrangler secret put JIRA_MCP_COMMAND
npx wrangler secret put JIRA_MCP_ARGS_JSON
npx wrangler secret put JIRA_BASE_URL
npx wrangler secret put JIRA_EMAIL
npx wrangler secret put JIRA_API_TOKEN
```

## 3. Codex 側の設定

Codex は `~/.codex/config.toml` の `[mcp_servers.<name>]` 形式を使う。
この repo は Codex のホーム設定を自動変更しないので、必要な値を手で追加する。

### Codex remote MCP snippet

```toml
[mcp_servers.jira]
url = "https://jira-mcp.example.com/sse"
```

Bearer token や custom header が必要なサーバーでは、Codex 側の運用ルールに合わせて追記する。

### Codex stdio MCP snippet

```toml
[mcp_servers.jira]
command = "npx"
args = ["-y", "<your-jira-mcp-package>"]

[mcp_servers.jira.env]
JIRA_BASE_URL = "https://your-site.atlassian.net"
JIRA_EMAIL = "you@example.com"
JIRA_API_TOKEN = "your-jira-api-token"
```

## 4. Jira 側の前提

handover の前提どおり、Jira 側では以下を作っておく。

- Project 内に `Opportunity`, `Project`, `Idea`, `Task` の Issue Type
- カスタムフィールド `金額`, `期日`, `顧客名`
- コメント運用と添付ファイル運用

この repo は Jira のスキーマ自体は作らない。MCP で操作できる前提条件だけを整える。
