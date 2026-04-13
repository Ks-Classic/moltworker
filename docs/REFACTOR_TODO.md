# Runtime Refactor TODO

この TODO は [RUNTIME_REBUILD_PLAN.md](/home/ykoha/moltworker/docs/RUNTIME_REBUILD_PLAN.md) に基づく実装順の管理用です。

## ゴール

- MoltWorker を OpenClaw の単一実行基盤にする
- health / readiness / restart を `runtime-state` 正本に寄せる
- Lark 導入前に runtime の真実を固定する

## Phase 1: Runtime Truth

- [x] `runtime-state` の土台を追加する
- [x] `runtime-state` に Discord readiness を明示的に入れる
- [x] `runtime-state` に restart reason を残す
- [x] `runtime-state` に desired fingerprint を残す

## Phase 2: Gateway Lifecycle

- [x] bootstrap と gateway supervision を分離する
- [x] token drift / model drift で再起動できるようにする
- [x] `ensureMoltbotGateway()` を state ベースに寄せる
- [x] process / port 単独判定を補助扱いに下げる
- [x] 起動成功判定を `waitForPort` から real HTTP 優先に寄せる

## Phase 3: Worker Health

- [x] `/api/status` を runtime status ベースに寄せ始める
- [x] `/debug/runtime-state` を追加する
- [x] loading 判定を runtime status ベースに統一する
- [x] degraded / starting / ready の返却基準を揃える

## Phase 4: OpenClaw Integration Boundary

- [ ] MoltWorker は transport / admin / debug / restart authority に集中させる
- [ ] OpenClaw は会話理解 / 業務判断 / ツール実行の主語に揃える
- [ ] Worker route に業務判断ロジックを増やさない
- [x] runtime 主線に Jira を再接続しない境界をテストで固定する
- [x] daily heartbeat の業務文面を Worker entrypoint から分離する
- [x] `scheduled` の実処理を `ops/scheduled.ts` へ分離する
- [x] admin route の主要手続きを `admin/service.ts` へ分離する
- [x] admin service の直接テストを追加する

## Phase 5: Lark

- [x] Lark MCP 注入ポイントを分離する
- [x] Lark 用 env の流し込みを整理する
- [ ] LINE webhook を OpenClaw が扱える transport/event に変換する
- [ ] Lark を業務 integration として追加する

## このターンで進める範囲

- [x] TODO 文書を追加する
- [x] desired runtime spec を追加する
- [x] process discovery を独立させる
- [x] `ensureMoltbotGateway()` を state ベースに寄せる
- [x] proxy の loading 判定を runtime status ベースにする
- [x] 主要テストを追加 / 更新する

## 次の着手候補

- [x] `admin/service.ts` の戻り値を `unknown` から明示型へ置き換える
- [x] `routes/debug.ts` も thin route + service 構成へ寄せる
- [x] repo 内の Jira 残骸を runtime 主線から明示的に隔離する
