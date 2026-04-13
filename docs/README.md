# Documentation Map

## 目的

このディレクトリは、MoltWorker の設計判断と実装方針の正本を整理するためのものです。

README や AGENTS.md にも概要は書くが、長期方針や再設計判断は `docs/` を正本にする。

## 最上位方針

このリポジトリの再設計目標は、**Cloudflare Worker + Sandbox 上の MoltWorker を OpenClaw の単一実行基盤として一本化すること** です。

ここでいう一本化とは次を意味する。

- OpenClaw の runtime の正本が MoltWorker 基盤内にある
- OpenClaw を生かすための health / readiness / restart の判断が MoltWorker 基盤内で閉じる
- proxy / admin / debug / transport の入口が MoltWorker に集約される
- 外部 integration は増やしても、OpenClaw の実行基盤の正本を外へ逃がさない

業務会話の理解、ツール実行、案件判断の主語は OpenClaw であり、MoltWorker はそれを Cloudflare 上で安定稼働させるための土台とする。

逆に、次は目標にしない。

- Jira や別サービスを OpenClaw 実行基盤の正本にすること
- Cloudflare 外に control plane を増やすこと
- runtime 問題を別 webhook service や別 daemon で隠すこと

## 文書の役割

### 1. `RUNTIME_REBUILD_PLAN.md`

現在の最上位方針。

- 何が根本問題か
- どこから直すか
- 何を先にやらないか

を定義する。

runtime / health / readiness の設計判断はこの文書を正本にする。

### 2. `openclaw-ops-roadmap.md`

runtime rebuild 完了後を見据えた運用基盤ロードマップ。

- diff / rollback / explainability
- config integrity
- owner-only admin
- change log

のような運用機能の中期計画を持つ。

runtime の根本設計を上書きしてはいけない。

### 3. `LARK_INTEGRATION_PLAN.md`

Lark 導入の後続計画。

- Lark MCP の注入
- Lark 用 env / config
- 必要なら webhook / task route

を扱う。

この文書は `RUNTIME_REBUILD_PLAN.md` の完了を前提にする。
runtime stability より先に Lark 実装を進める根拠には使わない。

## 更新ルール

### 正本の優先順位

1. `docs/RUNTIME_REBUILD_PLAN.md`
2. `docs/openclaw-ops-roadmap.md`
3. `docs/LARK_INTEGRATION_PLAN.md`
4. `README.md`
5. `AGENTS.md`

`README.md` と `AGENTS.md` は概要・運用注意を持つが、詳細方針の正本にはしない。

### 文書追加の基準

新しい文書を増やすのは次の場合だけにする。

- 既存文書に入れると責務が壊れる
- 実装フェーズが独立している
- 読み手が明確に違う

「思いつきを残すため」だけの文書は増やさない。

### 文書更新の原則

- runtime の真実は 1 回だけ書く
- 同じ判断を複数文書に重複させない
- 進捗は roadmap に書き、設計原則は rebuild plan に書く
- Lark の話は runtime rebuild を飛び越えて書かない

## 現在の読み順

1. `RUNTIME_REBUILD_PLAN.md`
2. `openclaw-ops-roadmap.md`
3. `LARK_INTEGRATION_PLAN.md`

## 現在の判断

- Jira は採用しない
- 先に runtime truth を再設計する
- Lark はそのあとに統合する
- 最終形は Cloudflare 上の MoltWorker を OpenClaw の単一実行基盤にすること
- historical Jira 補助スクリプトは `legacy/jira/` に隔離し、runtime 主線へ戻さない

## 現在の実装チェックポイント

- `runtime-state` を health / readiness 判定の中心に寄せ始めている
- public health は runtime status ベースへ寄っている
- `index.ts` は配線中心に薄くし、cron 実処理は `ops/` に逃がしている
- admin API の主要手続きは `admin/service.ts` に寄せ、route は薄くしている
- `admin/service.ts` の主要レスポンスは明示型へ寄せ、route 側の `unknown` 判定を減らしている
- `routes/debug.ts` の主要 debug 手続きも `debug/service.ts` に寄せ、route は配線中心に寄せている
- Jira を runtime 主線へ戻さない境界をテストで固定している
- repo 内の historical Jira スクリプトは `legacy/jira/` に隔離している
