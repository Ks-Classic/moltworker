import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getProcessLogs, getSecurityStatus } from './service';
import { createMockProcess, createMockSandbox, suppressConsole } from '../test-utils';
import * as gatewayModule from '../gateway';

vi.mock('../gateway', () => ({
  findExistingGatewayProcess: vi.fn(),
  getGatewayRuntimeStatus: vi.fn(),
  readRuntimeState: vi.fn(),
  waitForProcess: vi.fn(),
}));

describe('debug service', () => {
  beforeEach(() => {
    suppressConsole();
    vi.clearAllMocks();
    vi.mocked(gatewayModule.waitForProcess).mockResolvedValue(undefined);
  });

  it('returns gateway logs when no process id is provided', async () => {
    const { sandbox } = createMockSandbox();
    vi.mocked(gatewayModule.findExistingGatewayProcess).mockResolvedValue({
      id: 'gateway-1',
      status: 'running',
      getLogs: vi.fn().mockResolvedValue({ stdout: 'out\n', stderr: 'err\n' }),
    } as unknown as Awaited<ReturnType<typeof gatewayModule.findExistingGatewayProcess>>);

    const result = await getProcessLogs(sandbox);

    expect(result).toEqual({
      status: 'ok',
      process_id: 'gateway-1',
      process_status: 'running',
      stdout: 'out\n',
      stderr: 'err\n',
    });
  });

  it('returns security status and clears pending alerts when requested', async () => {
    const { sandbox, startProcessMock } = createMockSandbox();

    startProcessMock.mockImplementation(async (cmd: string) => {
      if (cmd.includes('security-alerts-pending.log')) {
        return createMockProcess('[CRITICAL] alert one\n[WARNING] alert two\n');
      }
      if (cmd.includes('pgrep -f security-monitor.sh')) {
        return createMockProcess('RUNNING\n');
      }
      if (cmd.includes('tail -50 /tmp/security-monitor.log')) {
        return createMockProcess('[INFO] monitor ok\n');
      }
      if (cmd.includes('rm -f /tmp/security-alerts-pending.log')) {
        return createMockProcess();
      }
      return createMockProcess();
    });

    const result = await getSecurityStatus(sandbox, true);

    expect(result).toEqual({
      status: 'RUNNING',
      alert_count: 2,
      alerts: ['[CRITICAL] alert one', '[WARNING] alert two'],
      has_critical: true,
      recent_log: '[INFO] monitor ok',
    });
    expect(startProcessMock).toHaveBeenCalledWith('rm -f /tmp/security-alerts-pending.log');
  });
});
