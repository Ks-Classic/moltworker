import type { Sandbox } from '@cloudflare/sandbox';
import { GATEWAY_RUNTIME_NAME, WORKER_RUNTIME_NAME } from '../config';
import {
  findExistingGatewayProcess,
  getGatewayRuntimeStatus,
  readRuntimeState,
  waitForProcess,
} from '../gateway';

const GATEWAY_PORT = 18789;

interface ProcessLogs {
  stdout: string;
  stderr: string;
}

interface ProcessSummary {
  id: string;
  command: string;
  status: string;
  startTime?: string;
  endTime?: string;
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
  logs_error?: string;
}

export interface VersionInfoResponse {
  worker_runtime: string;
  gateway_runtime: string;
  openclaw_version: string;
  moltbot_version: string;
  node_version: string;
}

export interface ProcessListResponse {
  count: number;
  processes: ProcessSummary[];
}

export interface GatewayApiProbeResponse {
  path: string;
  status: number;
  contentType: string;
  body: string | unknown;
}

export interface CliCommandResponse {
  command: string;
  status: string;
  exitCode?: number | null;
  stdout: string;
  stderr: string;
}

export interface DebugLogsResponse {
  status: 'ok' | 'not_found' | 'no_process';
  message?: string;
  process_id?: string;
  process_status?: string;
  stdout: string;
  stderr: string;
}

export interface SecurityStatusResponse {
  status: string;
  alert_count: number;
  alerts: string[];
  has_critical: boolean;
  recent_log: string;
}

export interface RuntimeStateDebugResponse {
  runtime: unknown;
  rawRuntime: unknown;
  runtimeFresh: boolean;
  runtimeAgeMs: number | null;
  gatewayHttpOk: boolean;
  gatewayHttpStatus: number | null;
  processId: string | null;
  processStatus: string | null;
  discord: unknown;
}

export interface ContainerConfigResponse {
  status: string;
  exitCode?: number | null;
  config: unknown | null;
  raw?: string;
  stderr: string;
}

async function readCommandLogs(
  sandbox: Sandbox,
  command: string,
  timeoutMs: number,
): Promise<ProcessLogs> {
  const proc = await sandbox.startProcess(command);
  await waitForProcess(proc, timeoutMs);
  const logs = await proc.getLogs();
  return {
    stdout: logs.stdout || '',
    stderr: logs.stderr || '',
  };
}

export async function getVersionInfo(sandbox: Sandbox): Promise<VersionInfoResponse> {
  const [openclawLogs, nodeLogs] = await Promise.all([
    readCommandLogs(sandbox, 'openclaw --version', 5_000),
    readCommandLogs(sandbox, 'node --version', 5_000),
  ]);

  const openclawVersion = (openclawLogs.stdout || openclawLogs.stderr).trim();

  return {
    worker_runtime: WORKER_RUNTIME_NAME,
    gateway_runtime: GATEWAY_RUNTIME_NAME,
    openclaw_version: openclawVersion,
    moltbot_version: openclawVersion,
    node_version: nodeLogs.stdout.trim(),
  };
}

export async function listProcesses(
  sandbox: Sandbox,
  includeLogs: boolean,
): Promise<ProcessListResponse> {
  const processes = await sandbox.listProcesses();
  const processData = await Promise.all(
    processes.map(async (process) => {
      const data: ProcessSummary = {
        id: process.id,
        command: process.command,
        status: process.status,
        startTime: process.startTime?.toISOString(),
        endTime: process.endTime?.toISOString(),
        exitCode: process.exitCode,
      };

      if (includeLogs) {
        try {
          const logs = await process.getLogs();
          data.stdout = logs.stdout || '';
          data.stderr = logs.stderr || '';
        } catch {
          data.logs_error = 'Failed to retrieve logs';
        }
      }

      return data;
    }),
  );

  const statusOrder: Record<string, number> = {
    running: 0,
    starting: 1,
    completed: 2,
    failed: 3,
  };

  processData.sort((left, right) => {
    const leftOrder = statusOrder[left.status] ?? 99;
    const rightOrder = statusOrder[right.status] ?? 99;
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }

    return (right.startTime || '').localeCompare(left.startTime || '');
  });

  return {
    count: processes.length,
    processes: processData,
  };
}

export async function probeGatewayApi(
  sandbox: Sandbox,
  path: string,
): Promise<GatewayApiProbeResponse> {
  const url = `http://localhost:${GATEWAY_PORT}${path}`;
  const response = await sandbox.containerFetch(new Request(url), GATEWAY_PORT);
  const contentType = response.headers.get('content-type') || '';

  let body: string | unknown;
  if (contentType.includes('application/json')) {
    body = await response.json();
  } else {
    body = await response.text();
  }

  return {
    path,
    status: response.status,
    contentType,
    body,
  };
}

export async function runCliCommand(
  sandbox: Sandbox,
  command: string,
): Promise<CliCommandResponse> {
  const proc = await sandbox.startProcess(command);
  await waitForProcess(proc, 120_000);

  const logs = await proc.getLogs();
  const status = proc.getStatus ? await proc.getStatus() : proc.status;
  return {
    command,
    status,
    exitCode: proc.exitCode,
    stdout: logs.stdout || '',
    stderr: logs.stderr || '',
  };
}

export async function getProcessLogs(
  sandbox: Sandbox,
  processId?: string,
): Promise<DebugLogsResponse> {
  let process = null;

  if (processId) {
    const processes = await sandbox.listProcesses();
    process = processes.find((entry) => entry.id === processId) || null;
    if (!process) {
      return {
        status: 'not_found',
        message: `Process ${processId} not found`,
        stdout: '',
        stderr: '',
      };
    }
  } else {
    process = await findExistingGatewayProcess(sandbox);
    if (!process) {
      return {
        status: 'no_process',
        message: 'No Moltbot process is currently running',
        stdout: '',
        stderr: '',
      };
    }
  }

  const logs = await process.getLogs();
  return {
    status: 'ok',
    process_id: process.id,
    process_status: process.status,
    stdout: logs.stdout || '',
    stderr: logs.stderr || '',
  };
}

export async function getSecurityStatus(
  sandbox: Sandbox,
  clear: boolean,
): Promise<SecurityStatusResponse> {
  const [alertLogs, statusLogs, monitorLogs] = await Promise.all([
    readCommandLogs(
      sandbox,
      'cat /tmp/security-alerts-pending.log 2>/dev/null || echo "NO_ALERTS"',
      5_000,
    ),
    readCommandLogs(
      sandbox,
      'pgrep -f security-monitor.sh > /dev/null 2>&1 && echo "RUNNING" || echo "STOPPED"',
      3_000,
    ),
    readCommandLogs(
      sandbox,
      'tail -50 /tmp/security-monitor.log 2>/dev/null || echo "NO_LOG"',
      5_000,
    ),
  ]);

  const alertContent = alertLogs.stdout.trim();
  const alerts =
    alertContent !== 'NO_ALERTS' && alertContent.length > 0
      ? alertContent.split('\n').filter((line) => line.trim().length > 0)
      : [];

  if (clear && alerts.length > 0) {
    await sandbox.startProcess('rm -f /tmp/security-alerts-pending.log');
  }

  return {
    status: statusLogs.stdout.trim(),
    alert_count: alerts.length,
    alerts,
    has_critical: alerts.some((alert) => alert.includes('CRITICAL')),
    recent_log: monitorLogs.stdout.trim(),
  };
}

export async function getRuntimeStateDebug(sandbox: Sandbox): Promise<RuntimeStateDebugResponse> {
  const [rawRuntime, status] = await Promise.all([
    readRuntimeState(sandbox),
    getGatewayRuntimeStatus(sandbox),
  ]);

  return {
    runtime: status.runtime,
    rawRuntime,
    runtimeFresh: status.runtimeFresh,
    runtimeAgeMs: status.runtimeAgeMs,
    gatewayHttpOk: status.gatewayHttpOk,
    gatewayHttpStatus: status.gatewayHttpStatus,
    processId: status.processId,
    processStatus: status.processStatus,
    discord: status.discord,
  };
}

export async function getContainerConfig(sandbox: Sandbox): Promise<ContainerConfigResponse> {
  const proc = await sandbox.startProcess('cat /root/.openclaw/openclaw.json');
  await waitForProcess(proc, 5_000);

  const logs = await proc.getLogs();
  const stdout = logs.stdout || '';
  const stderr = logs.stderr || '';

  let config: unknown | null = null;
  try {
    config = JSON.parse(stdout);
  } catch {
    config = null;
  }

  return {
    status: proc.status,
    exitCode: proc.exitCode,
    config,
    raw: config ? undefined : stdout,
    stderr,
  };
}
