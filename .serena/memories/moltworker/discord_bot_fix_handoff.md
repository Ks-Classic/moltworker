# Discord Bot 修正 — 引き継ぎ (2026-03-20 更新)

## 現在のステータス: ✅ 動作中
- Version: `c6387661`
- Discord ログイン済み、メンション応答確認済み
- `commands.native = true` でexec自動承認設定済み

## 修正済み
1. ✅ `groupPolicy: 'open'` — ギルドメッセージ許可
2. ✅ guilds record 形式 — 配列→オブジェクト
3. ✅ 孤児プロセス — trap handler + pkill
4. ✅ ロックファイル — `/tmp/openclaw-*/gateway.*.lock` の正しいパス削除
5. ✅ exec 承認タイムアウト — `commands.native = true` で自動承認

## 未解決
- P1: 10分周期Discord切断（OpenClaw既知バグ、リスタートループで自動復帰）
- P2: ディレクトリ統一（`/home/ykoha/moltworker` vs `/home/ykoha/projects/moltworker`）
- P3: Git push to fork

## 重要な注意
- `openclaw gateway restart --force` をコンテナ内で実行するな → リスタートループが壊れる
- 代わりに `POST /api/admin/gateway/restart` を使え
- ロックファイルは `/tmp/openclaw-<N>/gateway.<hash>.lock` にある

## GEMINI.md 更新
- v1.2 に moltworker プロジェクト固有ルール（MOLT-1〜5）を追加済み
