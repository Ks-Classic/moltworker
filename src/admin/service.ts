import type { Sandbox } from '@cloudflare/sandbox';
import type { MoltbotEnv } from '../types';
import { buildConfigDiffSummary, type ConfigDiffSummary } from '../config/diff';
import {
  ensureGatewayRuntime,
  findExistingGatewayProcess,
  syncToR2,
  waitForProcess,
} from '../gateway';

const CLI_TIMEOUT_MS = 20_000;
const SNAPSHOT_SCRIPT_PATH = '/usr/local/lib/openclaw/config-snapshots.cjs';
const DISCORD_MENTION_SCRIPT_PATH = '/usr/local/lib/openclaw/set-discord-mention-mode.cjs';
const OPENCLAW_GATEWAY_URL = 'ws://localhost:18789';

interface ProcessWithStatus {
  status: string;
  getStatus?: () => Promise<string>;
}

interface ProcessLogs {
  stdout: string;
  stderr: string;
}

export interface AdminCommandError {
  error: string;
  stdout?: string;
  stderr?: string;
  raw?: string;
  details?: string;
}

export interface ConfigSnapshotMetadata {
  id: string;
  createdAt: string;
  reason: string;
  files: string[];
}

export interface ConfigSnapshotListResponse {
  snapshots: ConfigSnapshotMetadata[];
}

export interface ConfigSnapshotRollbackResponse {
  success: true;
  restoredSnapshot: ConfigSnapshotMetadata;
  restartScheduled: boolean;
}

export interface DeviceApprovalResult {
  requestId: string;
  success: boolean;
  error?: string;
}

export interface PendingDeviceSummary {
  requestId: string;
  [key: string]: unknown;
}

export interface PairedDeviceSummary {
  deviceId?: string;
  [key: string]: unknown;
}

export interface DeviceListResponse {
  pending: PendingDeviceSummary[];
  paired: PairedDeviceSummary[];
  raw?: string;
  stderr?: string;
  parseError?: string;
}

export interface DeviceApprovalResponse {
  success: boolean;
  requestId: string;
  message: string;
  stdout: string;
  stderr: string;
}

export interface ApproveAllDevicesSuccessResponse {
  approved: string[];
  failed: DeviceApprovalResult[];
  message: string;
}

export interface StorageSyncSuccessResponse {
  success: true;
  message: string;
  lastSync: string | null;
}

export interface StorageSyncErrorResponse {
  success: false;
  error: string;
  details?: string;
}

export interface DiscordMentionModeUpdateResponse {
  success: boolean;
  guildId?: string;
  channelId?: string;
  requireMention?: boolean;
  stdout: string;
  stderr: string;
  error?: string;
}

export interface RestartGatewayResponse {
  success: true;
  message: string;
  previousProcessId?: string;
}

function quoteArgs(args: string[]): string {
  return args.map((part) => JSON.stringify(part)).join(' ');
}

function buildGatewayTokenArg(env: MoltbotEnv): string {
  return env.MOLTBOT_GATEWAY_TOKEN ? ` --token ${env.MOLTBOT_GATEWAY_TOKEN}` : '';
}

async function processFailed(proc: ProcessWithStatus): Promise<boolean> {
  const status = proc.getStatus ? await proc.getStatus() : proc.status;
  return status === 'failed';
}

function parseJsonObjectFromOutput(stdout: string): unknown | null {
  const jsonMatch = stdout.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return null;
  }

  return JSON.parse(jsonMatch[0]);
}

function parseJsonObjectFromOutputAs<T>(stdout: string): T | null {
  return parseJsonObjectFromOutput(stdout) as T | null;
}

async function runProcessWithLogs(sandbox: Sandbox, command: string): Promise<ProcessLogs & { failed: boolean }> {
  const proc = await sandbox.startProcess(command);
  await waitForProcess(proc, CLI_TIMEOUT_MS);
  const logs = await proc.getLogs();

  return {
    failed: await processFailed(proc),
    stdout: logs.stdout || '',
    stderr: logs.stderr || '',
  };
}

export async function getAdminSessionSummary(env: MoltbotEnv, accessUser?: { email: string; name?: string } | null): Promise<{
  accessUser: { email: string; name?: string } | null;
  canManage: boolean;
}> {
  const { hasOwnerAccess } = await import('../auth');
  return {
    accessUser: accessUser || null,
    canManage: hasOwnerAccess(env, accessUser?.email),
  };
}

export async function getConfigDiffSummary(sandbox: Sandbox): Promise<ConfigDiffSummary> {
  return buildConfigDiffSummary(sandbox);
}

export async function listConfigSnapshots(
  sandbox: Sandbox,
): Promise<ConfigSnapshotListResponse | AdminCommandError> {
  const result = await runProcessWithLogs(
    sandbox,
    `node "${SNAPSHOT_SCRIPT_PATH}" --list-json`,
  );

  if (result.failed) {
    return {
      error: 'Failed to list config snapshots',
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  return JSON.parse(result.stdout || '{"snapshots":[]}') as ConfigSnapshotListResponse;
}

export async function rollbackConfigSnapshot(
  sandbox: Sandbox,
  snapshotId?: string,
): Promise<ConfigSnapshotRollbackResponse | AdminCommandError> {
  const args = ['node', SNAPSHOT_SCRIPT_PATH, '--restore'];
  if (snapshotId) {
    args.push(snapshotId);
  }

  const result = await runProcessWithLogs(sandbox, quoteArgs(args));
  if (result.failed) {
    return {
      error: 'Failed to rollback config snapshot',
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  return {
    success: true,
    ...JSON.parse(result.stdout || '{}'),
  } as ConfigSnapshotRollbackResponse;
}

export async function listDevices(sandbox: Sandbox, env: MoltbotEnv): Promise<DeviceListResponse> {
  await ensureGatewayRuntime(sandbox, env);

  const result = await runProcessWithLogs(
    sandbox,
    `openclaw devices list --json --url ${OPENCLAW_GATEWAY_URL}${buildGatewayTokenArg(env)}`,
  );

  try {
    const parsed = parseJsonObjectFromOutputAs<DeviceListResponse>(result.stdout || '');
    if (parsed) {
      return parsed;
    }

    return {
      pending: [],
      paired: [],
      raw: result.stdout,
      stderr: result.stderr,
    };
  } catch {
    return {
      pending: [],
      paired: [],
      raw: result.stdout,
      stderr: result.stderr,
      parseError: 'Failed to parse CLI output',
    };
  }
}

export async function approveDevice(
  sandbox: Sandbox,
  env: MoltbotEnv,
  requestId: string,
): Promise<DeviceApprovalResponse> {
  await ensureGatewayRuntime(sandbox, env);

  const result = await runProcessWithLogs(
    sandbox,
    `openclaw devices approve ${requestId} --url ${OPENCLAW_GATEWAY_URL}${buildGatewayTokenArg(env)}`,
  );
  const success = result.stdout.toLowerCase().includes('approved') || !result.failed;

  return {
    success,
    requestId,
    message: success ? 'Device approved' : 'Approval may have failed',
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

export async function approveAllDevices(
  sandbox: Sandbox,
  env: MoltbotEnv,
): Promise<ApproveAllDevicesSuccessResponse | AdminCommandError> {
  await ensureGatewayRuntime(sandbox, env);

  const listResult = await runProcessWithLogs(
    sandbox,
    `openclaw devices list --json --url ${OPENCLAW_GATEWAY_URL}${buildGatewayTokenArg(env)}`,
  );

  let pending: Array<{ requestId: string }> = [];
  try {
    const parsed = parseJsonObjectFromOutputAs<{ pending?: Array<{ requestId: string }> }>(
      listResult.stdout || '',
    );
    pending = parsed?.pending || [];
  } catch {
    return { error: 'Failed to parse device list', raw: listResult.stdout };
  }

  if (pending.length === 0) {
    return { approved: [], failed: [], message: 'No pending devices to approve' };
  }

  const results: DeviceApprovalResult[] = [];
  for (const device of pending) {
    try {
      // eslint-disable-next-line no-await-in-loop -- sequential device approval required
      const approval = await approveDevice(sandbox, env, device.requestId);
      results.push({
        requestId: approval.requestId,
        success: approval.success,
      });
    } catch (err) {
      results.push({
        requestId: device.requestId,
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  const approved = results.filter((result) => result.success).map((result) => result.requestId);
  return {
    approved,
    failed: results.filter((result) => !result.success),
    message: `Approved ${approved.length} of ${pending.length} device(s)`,
  };
}

export async function getStorageStatus(sandbox: Sandbox, env: MoltbotEnv): Promise<{
  configured: boolean;
  missing?: string[];
  lastSync: string | null;
  message: string;
}> {
  const hasCredentials = !!(env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.CF_ACCOUNT_ID);
  const missing: string[] = [];

  if (!env.R2_ACCESS_KEY_ID) missing.push('R2_ACCESS_KEY_ID');
  if (!env.R2_SECRET_ACCESS_KEY) missing.push('R2_SECRET_ACCESS_KEY');
  if (!env.CF_ACCOUNT_ID) missing.push('CF_ACCOUNT_ID');

  let lastSync: string | null = null;
  if (hasCredentials) {
    try {
      const result = await sandbox.exec('cat /tmp/.last-sync 2>/dev/null || echo ""');
      const timestamp = result.stdout?.trim();
      if (timestamp) {
        lastSync = timestamp;
      }
    } catch {
      // Ignore sync status read failures.
    }
  }

  return {
    configured: hasCredentials,
    missing: missing.length > 0 ? missing : undefined,
    lastSync,
    message: hasCredentials
      ? 'R2 storage is configured. Your data will persist across container restarts.'
      : 'R2 storage is not configured. Paired devices and conversations will be lost when the container restarts.',
  };
}

export async function triggerStorageSync(
  sandbox: Sandbox,
  env: MoltbotEnv,
): Promise<StorageSyncSuccessResponse | StorageSyncErrorResponse> {
  const result = await syncToR2(sandbox, env);
  if (result.success) {
    return {
      success: true,
      message: 'Sync completed successfully',
      lastSync: result.lastSync ?? null,
    };
  }

  return {
    success: false,
    error: result.error ?? 'Sync failed',
    details: result.details,
  };
}

export async function updateDiscordMentionMode(
  sandbox: Sandbox,
  input: { guildId: string; channelId?: string; requireMention: boolean },
): Promise<DiscordMentionModeUpdateResponse> {
  const args = [
    'node',
    DISCORD_MENTION_SCRIPT_PATH,
    '--guild',
    input.guildId,
    '--require-mention',
    String(input.requireMention),
  ];

  if (input.channelId) {
    args.push('--channel', input.channelId);
  }

  const result = await runProcessWithLogs(sandbox, quoteArgs(args));
  if (result.failed) {
    return {
      success: false,
      error: 'Failed to update Discord mention policy',
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  return {
    success: true,
    guildId: input.guildId,
    channelId: input.channelId,
    requireMention: input.requireMention,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

export async function restartGateway(
  sandbox: Sandbox,
  env: MoltbotEnv,
): Promise<RestartGatewayResponse> {
  const existingProcess = await findExistingGatewayProcess(sandbox);

  if (existingProcess) {
    try {
      await existingProcess.kill();
    } catch (killError) {
      console.error('Error killing process:', killError);
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  ensureGatewayRuntime(sandbox, env).catch((err) => {
    console.error('Gateway restart failed:', err);
  });

  return {
    success: true,
    message: existingProcess
      ? 'Gateway process killed, new instance starting...'
      : 'No existing process found, starting new instance...',
    previousProcessId: existingProcess?.id,
  };
}
