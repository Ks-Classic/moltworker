# Legacy Jira Artifacts

このディレクトリは、runtime 主線から切り離した historical Jira 用の補助物置き場です。

- `sync-jira-config.cjs` は過去の Jira 運用向けスクリプト
- MoltWorker / OpenClaw の runtime, health, readiness, restart の正本には関与しない
- `package.json` の script や Worker route から参照しない

今後 Jira を再採用しない前提は [docs/RUNTIME_REBUILD_PLAN.md](/home/ykoha/moltworker/docs/RUNTIME_REBUILD_PLAN.md) を正本とします。
