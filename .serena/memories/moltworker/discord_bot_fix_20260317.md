# Moltworker Discord Bot 修正 — 2026-03-17

## 問題の経緯

### 問題1: HTTP 401 (前回の会話で修正済み)
- AI Gateway 認証方式の不一致
- `start-openclaw.sh` で `apiKey` → `headers: { 'cf-aig-authorization': 'Bearer ' + apiKey }` に修正
- **しかし apiKey を削除したのが次の問題を引き起こした**

### 問題2: No API key found (本会話で修正済み)
- エラー: `Agent failed before reply: No API key found for provider 'cf-ai-gw-google-ai-studio'`
- 原因: 問題1の修正で `apiKey` フィールドを削除し `headers` のみにしたが、OpenClaw は `apiKey` を `auth-profiles.json` に保存・参照する
- 修正: `start-openclaw.sh` L214 で `apiKey` を復元し `headers` と併用
```javascript
config.models.providers[providerName] = {
    baseUrl: baseUrl,
    apiKey: apiKey,  // auth-profiles.json に必要
    headers: { 'cf-aig-authorization': 'Bearer ' + apiKey }, // AI Gateway 認証
    api: api,
    models: [...]
};
```
- デプロイ済み: Version `fabf6406`
- コンテナ再作成済み（config に apiKey SET を確認済み）

### 問題3: 404 エラー（未解決）
- `CF_AI_GATEWAY_MODEL` を `google-ai-studio/gemini-3.1-flash-lite-preview` に変更済み
- ブラウザの Control UI でチャットすると `404 status code (no body)` が返る
- Gateway 再起動後も 404 が続いている

## 現在の状態
- Worker: `https://moltbot-sandbox.yasuhiko-kohata.workers.dev`
- `/api/status` → `{"ok":true,"status":"running"}`
- DEV_MODE: true, DEBUG_ROUTES: true
- `CF_AI_GATEWAY_MODEL`: `google-ai-studio/gemini-3.1-flash-lite-preview`（wrangler secret）
- AI Gateway 認証トークン: `UjOhZ5Dk3RKWw5BAbEonOVknvfZ3f4jc7UQMqiP4`
- AI Gateway: account `2f6116da4d8e792a49383a5e340d8a31`, gateway `openclaw`
- プロバイダーキー保存モード（Google AI Studio, Grok）

## デバッグ方法
- `wrangler tail moltbot-sandbox --format pretty` でリアルタイムログ
- `/debug/cli?cmd=...` でコンテナ内コマンド実行可能
- `/debug/env` で環境変数確認
- `/debug/logs` で Gateway ログ確認

## 未解決の疑問
- 404 の原因が AI Gateway 側かコンテナ内 Gateway 側か未特定
- AI Gateway のプロバイダーキー保存設定で `gemini-3.1-flash-lite-preview` がサポートされているか未確認
- `gemini-2.5-flash` に戻して基本動作を確認する手もある

## 実施済みのルール追加
- `~/.gemini/GEMINI.md`（= `~/.codex/AGENTS.md` symlink）に CR-6, CR-7 追加（v1.1）
- CR-6: 一次情報を最初に確認せよ
- CR-7: 外部リソースは公式ドキュメントで検証せよ

## ファイル
- Moltworker リポ: `/home/ykoha/moltworker`
- 修正ファイル: `start-openclaw.sh` (コンテナ内 `/usr/local/bin/start-openclaw.sh`)
- Wrangler config: `wrangler.jsonc`
- Discord サーバー: K's Classic (`1455869574355619934`), みらい創造舎・E-spiral (`1075560600878448680`)