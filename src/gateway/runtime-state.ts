import type { Sandbox } from '@cloudflare/sandbox';
import { MOLTBOT_PORT, RUNTIME_STATE_FILE, RUNTIME_STATE_STALE_AFTER_MS } from '../config';
import { findExistingGatewayProcess } from './process-discovery';

export interface RuntimeState {
  phase?: string;
  status?: string;
  updatedAt?: string;
  bootstrapStartedAt?: string;
  bootstrapCompletedAt?: string;
  gatewayStartedAt?: string;
  gatewayReadyAt?: string;
  gatewayExitedAt?: string;
  gatewayExitCode?: number;
  gatewayPid?: number;
  gatewayReady?: boolean;
  tokenConfigured?: boolean;
  desiredPrimaryModel?: string | null;
  desiredRuntimeFingerprint?: string | null;
  discordReady?: boolean;
  lastDiscordReadyAt?: string | null;
  lastDiscordHeartbeatAt?: string | null;
  lastDiscordError?: string | null;
  lastRestartReason?: string | null;
  lastError?: string | null;
}

export interface DiscordRuntimeSignal {
  connected: boolean;
  lastEventAt: string | null;
  latencyMs: number | null;
  reconnects: number | null;
  messagesReceived: number | null;
}

export interface GatewayRuntimeStatus {
  processId: string | null;
  processStatus: string | null;
  runtime: RuntimeState | null;
  runtimeFresh: boolean;
  runtimeAgeMs: number | null;
  gatewayHttpOk: boolean;
  gatewayHttpStatus: number | null;
  discord: DiscordRuntimeSignal;
}

export type GatewayLifecycleState = 'running' | 'starting' | 'degraded' | 'not_running';

export function isGatewayReady(status: Pick<GatewayRuntimeStatus, 'gatewayHttpOk' | 'runtime'>): boolean {
  if (status.gatewayHttpOk) {
    return true;
  }

  return status.runtime?.gatewayReady === true && status.runtime?.status === 'ready';
}

export function getGatewayLifecycleState(
  status: Pick<GatewayRuntimeStatus, 'gatewayHttpOk' | 'runtime'>,
): GatewayLifecycleState {
  if (isGatewayReady(status)) {
    return 'running';
  }

  if (isRuntimeStateStarting(status.runtime)) {
    return 'starting';
  }

  if (isRuntimeStateFresh(status.runtime)) {
    return 'degraded';
  }

  return 'not_running';
}

export function getRuntimeStateAgeMs(
  runtime: Pick<RuntimeState, 'updatedAt'> | null,
  nowMs: number = Date.now(),
): number | null {
  const updatedAt = runtime?.updatedAt;
  if (!updatedAt) {
    return null;
  }

  const updatedMs = Date.parse(updatedAt);
  if (Number.isNaN(updatedMs)) {
    return null;
  }

  return Math.max(0, nowMs - updatedMs);
}

export function isRuntimeStateFresh(
  runtime: Pick<RuntimeState, 'updatedAt'> | null,
  nowMs: number = Date.now(),
): boolean {
  const ageMs = getRuntimeStateAgeMs(runtime, nowMs);
  return ageMs !== null && ageMs <= RUNTIME_STATE_STALE_AFTER_MS;
}

export function isRuntimeStateStarting(
  runtime: Pick<RuntimeState, 'status' | 'phase' | 'updatedAt'> | null,
  nowMs: number = Date.now(),
): boolean {
  if (!isRuntimeStateFresh(runtime, nowMs)) {
    return false;
  }

  return (
    runtime?.status === 'starting' ||
    runtime?.phase === 'bootstrap' ||
    runtime?.phase === 'gateway-starting'
  );
}

function extractLatestDiscordSignal(logText: string): DiscordRuntimeSignal {
  const lines = logText.split('\n');
  let latestMetrics: DiscordRuntimeSignal = {
    connected: false,
    lastEventAt: null,
    latencyMs: null,
    reconnects: null,
    messagesReceived: null,
  };

  for (const line of lines) {
    const metricsMatch = line.match(
      /^(\d{4}-\d{2}-\d{2}T[^ ]+) discord gateway metrics: (\{.*\})$/,
    );
    if (metricsMatch) {
      try {
        const metrics = JSON.parse(metricsMatch[2]) as {
          latency?: number;
          reconnects?: number;
          messagesReceived?: number;
        };
        latestMetrics = {
          connected: true,
          lastEventAt: metricsMatch[1],
          latencyMs: metrics.latency ?? null,
          reconnects: metrics.reconnects ?? null,
          messagesReceived: metrics.messagesReceived ?? null,
        };
      } catch {
        // Ignore malformed metrics lines.
      }
    }
  }

  return latestMetrics;
}

function extractDiscordReadiness(logText: string): Pick<
  RuntimeState,
  'discordReady' | 'lastDiscordReadyAt' | 'lastDiscordHeartbeatAt' | 'lastDiscordError'
> {
  const lines = logText.split('\n');
  let lastDiscordReadyAt: string | null = null;
  let lastDiscordHeartbeatAt: string | null = null;
  let lastDiscordError: string | null = null;

  for (const line of lines) {
    const readyMatch = line.match(/^(\d{4}-\d{2}-\d{2}T[^ ]+) .*Gateway websocket opened/i);
    if (readyMatch) {
      lastDiscordReadyAt = readyMatch[1];
    }

    const metricsMatch = line.match(/^(\d{4}-\d{2}-\d{2}T[^ ]+) discord gateway metrics: (\{.*\})$/);
    if (metricsMatch) {
      lastDiscordHeartbeatAt = metricsMatch[1];
    }

    const errorMatch = line.match(/^(\d{4}-\d{2}-\d{2}T[^ ]+) (.*(?:discord|gateway websocket).*(?:error|closed|unauthorized).*)$/i);
    if (errorMatch) {
      lastDiscordError = errorMatch[2];
    }
  }

  const discordReady = lastDiscordHeartbeatAt !== null || lastDiscordReadyAt !== null;

  return {
    discordReady,
    lastDiscordReadyAt,
    lastDiscordHeartbeatAt,
    lastDiscordError,
  };
}

function hasExplicitDiscordRuntimeState(runtime: RuntimeState): boolean {
  return (
    runtime.discordReady === true ||
    runtime.lastDiscordReadyAt != null ||
    runtime.lastDiscordHeartbeatAt != null ||
    runtime.lastDiscordError != null
  );
}

function enrichRuntimeState(runtime: RuntimeState | null, logText: string): RuntimeState | null {
  if (!runtime) {
    return null;
  }

  if (hasExplicitDiscordRuntimeState(runtime)) {
    return runtime;
  }

  return {
    ...runtime,
    ...extractDiscordReadiness(logText),
  };
}

export async function readRuntimeState(sandbox: Sandbox): Promise<RuntimeState | null> {
  const result = await sandbox.exec(
    `node -e "const fs=require('fs'); try { process.stdout.write(fs.readFileSync('${RUNTIME_STATE_FILE}','utf8')); } catch { process.exit(1); }"`,
    { timeout: 10000 },
  );

  if (!result.success || !(result.stdout || '').trim()) {
    return null;
  }

  try {
    return JSON.parse(result.stdout) as RuntimeState;
  } catch {
    return null;
  }
}

export async function probeGatewayHttp(sandbox: Sandbox): Promise<{
  ok: boolean;
  status: number | null;
}> {
  try {
    const response = await sandbox.containerFetch(new Request(`http://localhost:${MOLTBOT_PORT}/`), MOLTBOT_PORT);
    return { ok: response.ok, status: response.status };
  } catch {
    return { ok: false, status: null };
  }
}

export async function getGatewayRuntimeStatus(sandbox: Sandbox): Promise<GatewayRuntimeStatus> {
  const [process, runtime, gatewayHttp] = await Promise.all([
    findExistingGatewayProcess(sandbox),
    readRuntimeState(sandbox),
    probeGatewayHttp(sandbox),
  ]);

  let discord = extractLatestDiscordSignal('');
  let logText = '';
  if (process) {
    try {
      const logs = await process.getLogs();
      logText = logs.stdout || '';
      discord = extractLatestDiscordSignal(logText);
    } catch {
      // Ignore log retrieval failures for status.
    }
  }

  const enrichedRuntime = enrichRuntimeState(runtime, logText);

  return {
    processId: process?.id ?? null,
    processStatus: process?.status ?? null,
    runtime: enrichedRuntime,
    runtimeFresh: isRuntimeStateFresh(enrichedRuntime),
    runtimeAgeMs: getRuntimeStateAgeMs(enrichedRuntime),
    gatewayHttpOk: gatewayHttp.ok,
    gatewayHttpStatus: gatewayHttp.status,
    discord,
  };
}

export {
  extractDiscordReadiness,
  extractLatestDiscordSignal,
  hasExplicitDiscordRuntimeState,
};
