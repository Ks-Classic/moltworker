# OpenClaw Ops Roadmap

> runtime の最上位方針は [RUNTIME_REBUILD_PLAN.md](/home/ykoha/moltworker/docs/RUNTIME_REBUILD_PLAN.md) を正本にする。
> この文書は runtime rebuild 後に効いてくる運用基盤の roadmap を扱う。

## 背景

このプロジェクトでは、OpenClaw を Discord 上の会話 bot として使うだけでなく、
設定変更、運用確認、復旧、将来的な自律運用まで扱える運用基盤へ育てる。

2026-03 の障害では、特に次の問題が顕在化した。

- `openclaw.json` の正本が曖昧で、R2 と runtime local が巻き戻し合った
- `requireMention` や Discord routing のような運用設定を、その場で安全に変えにくかった
- 「なぜ反応しないか」を即答できず、ログ調査コストが高かった
- gateway / Discord / config の状態を一目で把握する仕組みが弱かった

この文書は、その再発防止と運用基盤の進化計画をまとめた roadmap である。

## 目的

目標は次の 4 つ。

1. OpenClaw が安定して稼働すること
2. Discord から安全に設定変更できること
3. 障害時に「何が起きているか」を bot 自身が説明できること
4. 将来的に AI がより自律的に運用できるようにすること

加えて、OpenClaw を安定運用するための基盤責務を Cloudflare 上の MoltWorker に集約する。

- 状態確認
- 設定変更
- 復旧判断
- integration の入口

は MoltWorker の外に分散させない。

一方で、会話の理解、実務上の判断、ツール利用の主語は OpenClaw とする。

## 正本モデル

現在の設定モデルは次の通り。

- `config/openclaw.source.json`
  - baseline の宣言的設定
  - repo に置く
- `/root/.openclaw/openclaw.overrides.json`
  - runtime override の正本
  - Discord からの設定変更など、運用時に可変な設定を置く
- `openclaw/openclaw.json` または `/root/.openclaw/openclaw.json`
  - source + overrides から生成される生成物
  - 直接編集しない

## 運用原則

### 1. 正本は分離する

- baseline config は source に置く
- runtime 変更は overrides に置く
- 生成物 `openclaw.json` を正本にしない

### 2. runtime から generated config を R2 に逆流させない

- `sync-loop.sh` や manual sync は `openclaw.json` を push しない
- source / overrides / state を管理対象にする

### 3. Discord からの変更は単一パイプラインに通す

- 変更要求を受ける
- overrides を更新する
- `openclaw.json` を再生成する
- R2 に同期する
- gateway を再読込する

### 4. owner-only の境界を厳守する

- config 変更
- gateway 操作
- shell 実行
- 秘密情報まわり

これらは owner 限定で扱う。

### 5. explainability を優先する

「なぜ反応しなかったか」「なぜこの agent に流れたか」を、
ログ頼みではなく運用機能として説明できるようにする。

## 前提

この roadmap は、少なくとも以下が済んでから本格着手する。

- `runtime-state` が health の正本になっている
- Worker が process/port 判定から概ね離れている
- Discord readiness が明示状態になっている

つまり、runtime rebuild より先にこの roadmap を優先しない。

## すでに入ったもの

- `config/openclaw.source.json` の導入
- `openclaw.json` の generated 化
- `config:build` / `config:check`
- `match.channelId -> match.peer` の互換変換
- `sync-loop` から `openclaw.json` 除外
- Discord から mention policy を guild / channel 単位で変更する導線

## runtime rebuild 後の優先 backlog

### 1. Config diff

- [ ] 現在の source / overrides / generated の差分を見られるようにする
- [ ] Discord / 管理UI から確認できるようにする

### 2. Config rollback

- [ ] 直前の overrides スナップショットへ戻せるようにする
- [ ] 少なくとも 1 世代前には戻せるようにする

### 3. Mention / routing / allowlist 管理の拡張

- [ ] mention policy 変更の運用確認
- [ ] routing 変更の導線を追加
- [ ] allowlist 変更の導線を追加

### 4. Explainability

- [ ] 「なぜ無視したか」を返せる
- [ ] `mention`, `requireMention`, `route`, `channelConfig` を可視化する

### 5. Health summary

- [ ] gateway
- [ ] Discord provider
- [ ] R2 sync
- [ ] config source / overrides / generated 整合
- [ ] 最新 restart 理由

これらを 1 つの summary として返せるようにする。

### 6. Restart with reason

- [ ] 再起動時に reason を記録する
- [ ] 直近 restart reason を確認できるようにする

### 7. Config validation gate

- [ ] 変更前に validate
- [ ] validate failure なら apply しない
- [ ] failure reason を返す

### 8. Owner-only admin layer の明確化

- [ ] 危険操作の入口を一覧化
- [ ] owner 以外の拒否レスポンスを統一

### 9. Change log

- [ ] 誰が
- [ ] いつ
- [ ] 何を変えたか
- [ ] 成功/失敗

を残す。

### 10. Git / R2 / live 整合確認

- [ ] baseline source
- [ ] runtime overrides
- [ ] generated config
- [ ] running process

のズレをチェックできるようにする。

## 中期

- structured admin commands
- channel policy
- memory policy
- self-heal 強化
- runtime anomaly detection
- config snapshots
- admin dashboard 強化
- skill policy

## 将来

- self-governance
- autonomous config proposals
- incident postmortem generation
- predictive operations
- safe autonomous deploys
- knowledge-grounded ops

## 実装順の指針

次の順で進める。

1. diff
2. rollback
3. explainability
4. health summary
5. routing / allowlist 管理
6. change log
7. 整合確認

## 完了条件

「運用基盤が整った」と言える条件は次の通り。

- Discord から重要設定を安全に変えられる
- 変更は rollback できる
- OpenClaw 自身が現在状態を説明できる
- 反応しない理由を bot 側で説明できる
- source / overrides / generated / running state のズレが見える

## 更新履歴

- 2026-03-25: 初版作成
