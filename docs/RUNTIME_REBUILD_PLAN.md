# MoltWorker Runtime Rebuild Plan

> この文書は `docs/` 配下の最上位方針です。
> 文書全体の役割は [README.md](/home/ykoha/moltworker/docs/README.md) を参照。

## 目的

MoltWorker の根本問題は、実行状態の真実が複数に分裂していることです。

現在は少なくとも以下が別々に存在しています。

- Worker 側の health 判定
- supervisor 親プロセス
- 実際の `openclaw-gateway`
- Discord provider の接続状態
- Worker secrets
- コンテナ起動時 env
- `openclaw.json`

この構成だと「`/api/status` は false だが gateway は 200 を返す」「Discord は metrics を出しているのに offline に見える」のような観測ズレが起きます。

この文書は、現状確認と、Lark 前提での最適な全面リファクタ方針をまとめた正本です。

最終目標は、**Cloudflare Worker + Sandbox 上の MoltWorker を OpenClaw の単一実行基盤にすること** です。

## スコープ

この文書が扱うのは以下です。

- runtime truth
- Worker health / readiness
- gateway lifecycle
- Discord readiness
- restart authority

以下は直接は扱わない。

- Lark の具体的な MCP 注入方法
- 中長期の運用機能 backlog

それらは別文書で扱う。

## 一本化の定義

この再設計で目指す「Cloudflare Moltworker 一本化」は次を意味する。

- gateway lifecycle の正本が MoltWorker にある
- health / readiness / restart authority が MoltWorker にある
- OpenClaw を起動するための config truth が MoltWorker の管理下で閉じる
- debug / admin / transport の入口が MoltWorker に集約される

したがって、外部ツールや外部サービスは OpenClaw の連携先にはなっても、実行基盤の正本にはしない。

ここで重要なのは、会話理解や業務判断の主語は OpenClaw であり、MoltWorker はそれを Cloudflare 上で常時稼働させるための control plane / runtime plane だという点である。

## 2026-04-09 時点の事実

### 1. デプロイ自体は成功している

- GitHub Actions の `Deploy OpenClaw` は成功
- Cloudflare 上の新しい image も反映済み

### 2. gateway は実際には起動している

確認済みの事実:

- `debug/gateway-api?path=/` は `200` を返す
- コンテナ内ログには `listening on ws://0.0.0.0:18789` が出ている
- `openclaw-gateway` プロセスも生存している

### 3. Discord も少なくとも websocket 維持まではできている

確認済みの事実:

- `Gateway websocket opened` のログがある
- `discord gateway metrics` が継続して出ている
- `reconnects: 0` のまま uptime が増えている

### 4. 既存の `api/status` は真実を返していない

`/api/status` が `not_responding` を返した一方で、実 gateway HTTP は `200` を返した。

つまり現在の status は「実システムの健康状態」ではなく、「Worker 側の古い判定ロジックの結果」を返していた。

## 現在入っている改善

### 起動責務の分離

- `start-openclaw.sh`
  - 薄い orchestrator
- `scripts/bootstrap-openclaw.sh`
  - restore / config build / patch / doctor / background daemons
- `scripts/run-openclaw-gateway.sh`
  - gateway supervision

### drift 再起動の改善

- token drift
- model drift

を検知して既存 gateway を再起動する改善を追加済み。

### `runtime-state` の土台

追加済み:

- `scripts/write-runtime-state.cjs`
- `src/gateway/runtime-state.ts`
- `GET /debug/runtime-state`

また、起動スクリプトは phase を `/tmp/openclaw-runtime-state.json` に書くようになっている。

## 現在まだ足りないもの

### 1. Worker の lifecycle がまだ `runtime-state` を正本にしていない

以下はまだ完全には置き換わっていない:

- `ensureMoltbotGateway()`
- process ベースの再起動判断
- startup timeout の扱い

### 2. Discord readiness が state に入っていない

今は `discord gateway metrics` をログから推定しているだけで、以下が明示されていない:

- `discordReady`
- `lastDiscordReadyAt`
- `lastDiscordHeartbeatAt`
- `lastDiscordError`

### 3. health source がまだ混在している

理想は `runtime-state` + 実 gateway HTTP 応答の 2 つだけを見ることだが、まだ process / port / logs の古いロジックも残っている。

## Lark 前提での方針

Jira はやめる。

今後の業務 integration の主軸は Lark に寄せる。

ただし、Lark を先に無理やり載せるのは順序が悪い。
理由は、現在の runtime 自体が不安定で、MCP を増やす前に lifecycle の真実を固定すべきだから。

したがって優先順位は:

1. runtime rebuild
2. health / readiness rebuild
3. MoltWorker を OpenClaw の単一実行基盤として一本化
4. その後に Lark MCP integration

## 最適な全面リファクタ

### Phase 1: Runtime Truth を 1 本化する

正本は `/tmp/openclaw-runtime-state.json` とする。

このファイルに最低限入れる:

- `phase`
- `status`
- `gatewayPid`
- `gatewayReady`
- `gatewayReadyAt`
- `gatewayExitCode`
- `lastError`
- `tokenConfigured`
- `desiredPrimaryModel`
- `discordReady`
- `lastDiscordReadyAt`
- `lastDiscordHeartbeatAt`
- `lastDiscordError`

### Phase 2: Worker health を state + real HTTP に寄せる

Worker は以下だけを見る:

- `runtime-state`
- `sandbox.containerFetch()` での実 gateway 応答

以下は health source から外す:

- `waitForPort()` 単独判定
- supervisor 親プロセスの status

### Phase 3: Discord readiness を明示状態にする

以下のどちらかを採る:

- OpenClaw ログから確実な `READY` / heartbeat 指標を抽出して state に書く
- 可能なら OpenClaw 側の readiness endpoint / diagnostic command を使う

「websocket が開いた」だけでは readiness とみなさない。

### Phase 4: Restart authority を Worker に寄せる

最終的には restart authority を Worker 側に寄せるのが望ましい。

つまり:

- コンテナ内 shell loop は最小化
- 再起動判断は Worker が `runtime-state` を見て行う

ただしこれは変更が大きいので、Phase 1-3 のあとで良い。

### Phase 5: Lark integration

runtime が安定したら、Lark を入れる。

この時にやること:

- `patch-config.cjs` に Lark MCP 注入
- 必要 env の container への受け渡し整理
- 必要なら Lark webhook / task route の追加
- ただし transport と control plane は MoltWorker 内に残し、会話理解と業務実行は OpenClaw 側に寄せる

Jira 用の設計やドキュメントはここでは復活させない。

## 現実的な次の一手

最短で価値がある順:

1. `runtime-state` に Discord readiness を追加
2. `api/status` を `runtime-state` 正本ベースに寄せ切る
3. `ensureMoltbotGateway()` を state ベースの ensure に作り替える
4. そのあとで Lark MCP を載せる

## やらないこと

当面は以下をやらない:

- Jira MCP の復活
- Worker route に Jira/Lark の業務ロジックを直接増やすこと
- process/port 判定を温存したまま integrations だけ増やすこと

## 判断

最適なリファクタは「部分修正の継続」ではなく、「runtime truth を中心にした全面再設計」である。

そのうえで、業務 integration は Jira ではなく Lark を採用する。
ただし、最終形は Cloudflare 上の MoltWorker を OpenClaw の単一実行基盤にすることとする。

## 文書の出口

この文書の内容が固まったあとに参照する先は次の 2 つ。

- 運用機能の中期計画: [openclaw-ops-roadmap.md](/home/ykoha/moltworker/docs/openclaw-ops-roadmap.md)
- Lark の後続統合: [LARK_INTEGRATION_PLAN.md](/home/ykoha/moltworker/docs/LARK_INTEGRATION_PLAN.md)
