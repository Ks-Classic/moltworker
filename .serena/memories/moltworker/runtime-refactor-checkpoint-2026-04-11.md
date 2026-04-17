2026-04-11 checkpoint.

Goal remains: make MoltWorker the single Cloudflare-side control plane for the OpenClaw runtime.

What was completed in this stretch:
- Added architecture boundary tests to prevent Jira from re-entering the runtime path and to keep MoltWorker/OpenClaw ownership explicit.
- Introduced runtime naming constants in src/config.ts so public-facing naming is MoltWorker/OpenClaw while legacy moltbot identifiers remain only for compatibility.
- Updated public health/debug/index surfaces so the visible model is MoltWorker control plane + OpenClaw gateway/runtime.
- Renamed main gateway orchestration references toward ensureGatewayRuntime / findExistingGatewayProcess, while keeping backward-compatible aliases for legacy names.
- Moved daily heartbeat prompt/command generation out of src/index.ts into src/ops/heartbeat.ts.
- Moved scheduled handler logic out of src/index.ts into src/ops/scheduled.ts.
- Extracted major admin route procedures into src/admin/service.ts so routes are thinner and closer to auth/input/http adaptation only.
- Added direct unit tests for src/admin/service.ts and ops modules.

Current architectural shape:
- src/index.ts is mostly wiring/proxy entrypoint.
- src/routes/* are becoming thin route adapters.
- src/ops/* owns scheduled/control-plane operational workflows.
- src/admin/service.ts owns admin orchestration procedures.
- src/gateway/* owns runtime supervision and runtime-state logic.

Known remaining work:
- src/admin/service.ts still returns many values as unknown; next step is to replace with explicit response/result types.
- src/routes/debug.ts should be thinned into a service-oriented structure like admin routes.
- Historical Jira artifact scripts still exist in the repo and should be explicitly isolated or removed from the runtime storyline.
- Legacy moltbot naming aliases still exist for compatibility and can be narrowed further later.

Verification completed during this stretch:
- npm run typecheck passed.
- Targeted vitest suites passed for architecture-boundary, public route health, gateway process, scheduled ops, heartbeat ops, admin service, and api routes.
