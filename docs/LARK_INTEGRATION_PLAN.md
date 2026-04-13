# Lark × OpenClaw 統合計画

> 前提の runtime 再設計方針は [RUNTIME_REBUILD_PLAN.md](/home/ykoha/moltworker/docs/RUNTIME_REBUILD_PLAN.md) を正本にする。
> この文書は runtime rebuild 完了後の Lark 統合だけを扱う。

## 位置づけ

Jira は採用しない。

今後の業務 integration は Lark に寄せるが、Lark を先に載せて runtime 不安定を隠すことはしない。

Lark を入れる場合も、構成は Cloudflare Moltworker を OpenClaw の単一実行基盤とする原則を崩さない。

- Lark は OpenClaw の業務 integration として入れる
- OpenClaw 実行基盤の正本を Lark 側へ移さない
- 外部常駐 service を増やさない

この文書は以下が終わっていることを前提にする。

- `runtime-state` が health / readiness の正本になっている
- `ensureMoltbotGateway()` が state ベースに寄っている
- Discord readiness の観測が明示化されている

## 次ステップの要件（MoltWorker側）
1. **Lark MCPの起動**
   * オープンソースのLark Base MCPサーバー（`lark-deals`等）をコンテナ内で起動し、OpenClawのツールとして登録する。
2. **`patch-config.cjs` の動的書き換え**
   * `patch-config.cjs` に `patchLarkMcp(config)` を追加し、Lark MCP サーバーを動的に注入する。
   * 環境変数（`LARK_APP_ID`, `LARK_APP_SECRET` 等）をコンテナに流し込み、ランタイムで設定を生成する。
3. **Webhookエンドポイントの整備 (LINE用)**
   * MoltWorker の HTTP ルートで LINE からの webhook を受け取り、OpenClaw が扱える transport/event に変換して渡す。

## やらないこと

- Jira MCP を前提に戻すこと
- runtime rebuild 前に Lark route を増やすこと
- health 問題を残したまま integration だけ先に進めること
- MoltWorker 外に Lark 専用の control plane を作ること
- MoltWorker に業務判断ロジックを過剰に寄せること
