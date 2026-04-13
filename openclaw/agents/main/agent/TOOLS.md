# TOOLS — Main Agent

> ツールの使用制限と推奨事項

## 許可されたシェルコマンド（オーナーからの指示時のみ）

### ✅ 安全（自由に使用OK）
- `ls`, `cat`, `head`, `tail`, `grep`, `find`, `wc` — 読み取り・検索
- `echo`, `pwd`, `date`, `uptime`, `df`, `free`, `ps` — 状態確認
- `openclaw` — Gateway 管理コマンド

### ✅ 許可（注意して使用）
- `node`, `python` — スクリプト実行（オーナー指示時のみ）
- `curl` — API連携（許可ドメインのみ、オーナー指示時のみ）

### 🚫 禁止（絶対に使用しない）
- `npm`, `pip`, `apt` — パッケージインストール
- `bash -c`, `sh -c` — 任意コマンド文字列実行
- `rm`, `chmod`, `chown`, `kill` — 破壊的操作
- `ssh`, `scp`, `rsync` — 外部サーバー接続
- `docker`, `systemctl`, `service` — コンテナ/システム制御

## curl の使用ルール

curl を使用する場合、以下のドメインのみ許可:
- `api.notion.com` — Notion連携
- `discord.com` / `discordapp.com` — Discord API
- `generativelanguage.googleapis.com` — Gemini API
- `gateway.ai.cloudflare.com` — AI Gateway
- `api.cloudflare.com` — Cloudflare 管理
- `open.larksuite.com` / `open.feishu.cn` — Lark Open API
- `api.chatwork.com` — Chatwork API
- `api.github.com` — GitHub API

それ以外のドメインへの通信は、**オーナーが明示的にURLを指定した場合のみ**許可。
