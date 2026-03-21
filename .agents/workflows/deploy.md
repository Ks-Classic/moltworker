---
description: Moltworker (OpenClaw) のビルド・デプロイ・動作確認の完全手順
---

# Moltworker デプロイワークフロー

> **原則**: デプロイ前に検証、デプロイ後にログの stderr を最初に確認。推測でデバッグしない。

---

## 1. 事前検証（デプロイ前に必ず実施）

### 1-1. OpenClaw config の整合性チェック
// turbo
```bash
cd /home/ykoha/moltworker && node -e "
const fs = require('fs');
const config = JSON.parse(fs.readFileSync('/home/ykoha/.openclaw/openclaw.json', 'utf8'));
const errors = [];

// Discord: dmPolicy=open なら allowFrom: ['*'] が必須
const dc = config.channels?.discord;
if (dc?.dmPolicy === 'open' && (!dc.allowFrom || !dc.allowFrom.includes('*'))) {
  errors.push('channels.discord: dmPolicy=open requires allowFrom: [\"*\"]');
}

// Telegram: dmPolicy=open なら allowFrom: ['*'] が必須
const tg = config.channels?.telegram;
if (tg?.dmPolicy === 'open' && (!tg.allowFrom || !tg.allowFrom.includes('*'))) {
  errors.push('channels.telegram: dmPolicy=open requires allowFrom: [\"*\"]');
}

// model 形式チェック
const model = config.agents?.defaults?.model;
if (model && typeof model === 'string') {
  errors.push('agents.defaults.model must be { primary: \"provider/model\" }, not a string');
}

if (errors.length > 0) {
  console.error('❌ Config validation FAILED:');
  errors.forEach(e => console.error('  - ' + e));
  process.exit(1);
} else {
  console.log('✅ Config validation passed');
}
"
```

### 1-2. R2 バケット名の一貫性チェック
// turbo
```bash
cd /home/ykoha/moltworker && echo "--- wrangler.jsonc ---" && grep bucket_name wrangler.jsonc && echo "--- start-openclaw.sh ---" && grep R2_BUCKET_NAME start-openclaw.sh && echo "--- src/config.ts ---" && grep R2_BUCKET_NAME src/config.ts || grep openclaw-data src/config.ts
```
全て `openclaw-data` であることを確認。

### 1-3. patch-config.cjs シミュレーション実行 + config バリデーション

> **背景**: 2026-03-20 に patch-config.cjs が未サポートの `shell`/`network` キーを追加し、
> ゲートウェイが16時間起動不能になったインシデントを受けて追加。

// turbo
```bash
cd /home/ykoha/moltworker && cp /home/ykoha/.openclaw/openclaw.json /tmp/config-predeploy-test.json && CONFIG_PATH=/tmp/config-predeploy-test.json node scripts/patch-config.cjs 2>&1
```

パッチが正常に完了することを確認。次にパッチ後のconfigにOpenClawが認識しないキーが含まれないかチェック：

// turbo
```bash
cd /home/ykoha/moltworker && node -e '
const fs = require("fs");
const config = JSON.parse(fs.readFileSync("/tmp/config-predeploy-test.json", "utf8"));
const KNOWN_AGENT_KEYS = ["id","name","default","workspace","compaction","maxConcurrent","subagents","sandbox","model"];
const errors = [];
for (const agent of (config.agents?.list || [])) {
  for (const key of Object.keys(agent)) {
    if (!KNOWN_AGENT_KEYS.includes(key)) {
      errors.push(`agents.list[${agent.id}]: unknown key "${key}" (OpenClaw will reject this)`);
    }
  }
}
if (errors.length > 0) {
  console.error("❌ Config validation FAILED (unknown agent keys):");
  errors.forEach(e => console.error("  - " + e));
  process.exit(1);
} else {
  console.log("✅ Config agent keys validation passed");
}
'
```

### 1-4. ユニットテスト実行
// turbo
```bash
cd /home/ykoha/moltworker && npm test 2>&1
```
全テストが pass することを確認。

---

## 2. ビルド & デプロイ

### 2-1. ビルド
// turbo
```bash
cd /home/ykoha/moltworker && npm run build 2>&1
```

### 2-2. ビルド成果物にバケット名が正しいか確認
// turbo
```bash
cd /home/ykoha/moltworker && grep -o '"bucket_name":"[^"]*"' dist/moltbot_sandbox/wrangler.json
```
`"bucket_name":"openclaw-data"` であること。

### 2-3. デプロイ
```bash
cd /home/ykoha/moltworker && npx wrangler deploy --name moltbot-sandbox 2>&1
```
新しい Docker イメージがプッシュされ `SUCCESS` が出ることを確認。

---

## 3. デプロイ後の動作確認

> ⛔ **ゲート**: 以下の全ステップが完了するまで、次のコミット・デプロイを絶対に行わないこと。
> 2026-03-20 インシデントでは、確認を待たず10分で次のデプロイが実行され、障害を16時間放置した。

### 3-1. コンテナ起動待ち（60秒）
// turbo
```bash
sleep 60
```

### 3-2. ★最重要★ プロセスの stderr を最初に確認
// turbo
```bash
curl -s "https://moltbot-sandbox.yasuhiko-kohata.workers.dev/debug/logs" | python3 -c "
import sys,json
d = json.load(sys.stdin)
status = d.get('process_status', 'unknown')
stderr = d.get('stderr', '')
print(f'PROCESS STATUS: {status}')
if stderr:
    print(f'❌ STDERR (MUST FIX):')
    print(stderr)
else:
    print('✅ STDERR: empty (no errors)')
# Show last few lines of stdout
stdout = d.get('stdout', '')
lines = stdout.strip().split('\n')
print(f'STDOUT (last 5 lines):')
for line in lines[-5:]:
    print(f'  {line}')
"
```

**ここで stderr にエラーがあったら、以降の手順に進まずに修正すること。**

### 3-3. ゲートウェイ API ステータス確認
// turbo
```bash
curl -s "https://moltbot-sandbox.yasuhiko-kohata.workers.dev/api/status"
```
`{"ok":true,"status":"running"}` であること。`not_responding` の場合は30秒待って再試行（起動に時間がかかる）。

### 3-4. Discord 動作確認
Discord でボットにメンションして応答を確認。

---

## 4. トラブルシュート

### 原則
1. **stderr を最初に読め** — stdout ではなく stderr にエラーが出る
2. **推測でデバッグするな** — ログに書いてあるエラーメッセージをそのまま対処
3. **R2 の古い config に注意** — パッチで修正しても R2 に古いファイルが残っている可能性あり

### よくあるエラーと対処

| エラー (stderr) | 原因 | 対処 |
|---|---|---|
| `channels.discord.dm.allowFrom: ... requires allowFrom` | `dmPolicy: "open"` に `allowFrom: ["*"]` が無い | R2の `openclaw.json` を修正して再アップロード |
| `Config invalid` | openclaw.json のバリデーション失敗 | `openclaw doctor --fix` をコンテナ内で実行、または R2 のファイルを直接修正 |
| `ProcessExitedBeforeReadyError` | ゲートウェイがポート18789で listen する前にクラッシュ | stderr でクラッシュ原因を確認 |

### R2 上の openclaw.json を直接修正する手順
```bash
# 1. ダウンロード
cd /home/ykoha/.openclaw
WRANGLER=/home/ykoha/moltworker/node_modules/.bin/wrangler
$WRANGLER r2 object get openclaw-data/openclaw/openclaw.json --file /tmp/r2-fix.json --remote

# 2. 修正（例: allowFrom 追加）
python3 -c "
import json
with open('/tmp/r2-fix.json') as f: c = json.load(f)
# 修正をここに書く
c['channels']['discord']['allowFrom'] = ['*']
with open('/tmp/r2-fix.json', 'w') as f: json.dump(c, f, indent=2)
"

# 3. アップロード
$WRANGLER r2 object put openclaw-data/openclaw/openclaw.json --file /tmp/r2-fix.json --remote

# 4. ゲートウェイ再起動
curl -s -X POST "https://moltbot-sandbox.yasuhiko-kohata.workers.dev/debug/restart"
```

---

## 参考: Secret 一覧

| Secret | 用途 | 必須 |
|---|---|---|
| `GEMINI_API_KEY` | Gemini API キー | ✅ |
| `CLOUDFLARE_AI_GATEWAY_API_KEY` | AI Gateway 経由のAPIキー | ✅ |
| `CF_AI_GATEWAY_ACCOUNT_ID` | AI Gateway アカウントID | ✅ |
| `CF_AI_GATEWAY_GATEWAY_ID` | AI Gateway ゲートウェイID | ✅ |
| `CF_AI_GATEWAY_MODEL` | モデル指定 (例: `google-ai-studio/gemini-3.1-flash-lite-preview`) | ✅ |
| `MOLTBOT_GATEWAY_TOKEN` | ゲートウェイ認証トークン | ✅ |
| `DISCORD_BOT_TOKEN` | Discord Bot トークン | ✅ |
| `DISCORD_DM_POLICY` | `open` or `pairing` | ✅ |
| `DISCORD_GUILD_IDS` | Discord サーバーID | ✅ |
| `CF_ACCOUNT_ID` | Cloudflare アカウントID | ✅ |
| `R2_ACCESS_KEY_ID` | R2 アクセスキー | ✅ |
| `R2_SECRET_ACCESS_KEY` | R2 シークレットキー | ✅ |
| `DEV_MODE` | `true` で CF Access 認証スキップ | 任意 |
| `DEBUG_ROUTES` | `true` で `/debug/*` 有効化 | 任意 |
| `GOG_KEYRING_PASSWORD` | gog keyring 復号パスフレーズ | Google連携時 |
| `GOG_ACCOUNT` | Google アカウントメール | Google連携時 |

## 参考: バケット・パス対応表

| R2 パス | コンテナ内パス |
|---|---|
| `openclaw-data/openclaw/` | `/root/.openclaw/` |
| `openclaw-data/openclaw/gog-config/` | `/root/.config/gogcli/`（起動時にコピー） |
| `openclaw-data/workspace/` | `/root/clawd/` |
| `openclaw-data/skills/` | `/root/clawd/skills/` |
