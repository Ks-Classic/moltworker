import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  approveAllDevices,
  approveDevice,
  getStorageStatus,
  listDevices,
  restartGateway,
} from './service';
import { createMockEnv, createMockEnvWithR2, createMockProcess, createMockSandbox, suppressConsole } from '../test-utils';
import * as gatewayModule from '../gateway';

vi.mock('../gateway', () => ({
  ensureGatewayRuntime: vi.fn(),
  findExistingGatewayProcess: vi.fn(),
  syncToR2: vi.fn(),
  waitForProcess: vi.fn(),
}));

describe('admin service', () => {
  beforeEach(() => {
    suppressConsole();
    vi.clearAllMocks();
    vi.mocked(gatewayModule.ensureGatewayRuntime).mockResolvedValue(
      createMockProcess() as Awaited<ReturnType<typeof gatewayModule.ensureGatewayRuntime>>,
    );
    vi.mocked(gatewayModule.waitForProcess).mockResolvedValue(undefined);
  });

  it('lists devices by parsing the OpenClaw CLI JSON output', async () => {
    const { sandbox, startProcessMock } = createMockSandbox();
    startProcessMock.mockResolvedValue(
      createMockProcess('info line\n{"pending":[{"requestId":"req-1"}],"paired":[]}\n'),
    );

    const result = await listDevices(sandbox, createMockEnv({ MOLTBOT_GATEWAY_TOKEN: 'secret' }));

    expect(result).toEqual({
      pending: [{ requestId: 'req-1' }],
      paired: [],
    });
    expect(startProcessMock).toHaveBeenCalledWith(
      'openclaw devices list --json --url ws://localhost:18789 --token secret',
    );
  });

  it('approves a single device and reports success from CLI output', async () => {
    const { sandbox, startProcessMock } = createMockSandbox();
    startProcessMock.mockResolvedValue(createMockProcess('Approved req-1\n'));

    const result = await approveDevice(sandbox, createMockEnv(), 'req-1');

    expect(result).toMatchObject({
      success: true,
      requestId: 'req-1',
      message: 'Device approved',
    });
    expect(startProcessMock).toHaveBeenCalledWith(
      'openclaw devices approve req-1 --url ws://localhost:18789',
    );
  });

  it('approves all pending devices sequentially', async () => {
    const { sandbox, startProcessMock } = createMockSandbox();
    startProcessMock
      .mockResolvedValueOnce(
        createMockProcess('{"pending":[{"requestId":"req-1"},{"requestId":"req-2"}],"paired":[]}\n'),
      )
      .mockResolvedValueOnce(createMockProcess('Approved req-1\n'))
      .mockResolvedValueOnce(createMockProcess('Approved req-2\n'));

    const result = await approveAllDevices(sandbox, createMockEnv());

    expect(result).toEqual({
      approved: ['req-1', 'req-2'],
      failed: [],
      message: 'Approved 2 of 2 device(s)',
    });
    expect(startProcessMock).toHaveBeenCalledTimes(3);
  });

  it('reports configured R2 storage and last sync timestamp', async () => {
    const { sandbox, execMock } = createMockSandbox();
    execMock.mockResolvedValue({ stdout: '2026-04-11T00:00:00.000Z\n' });

    const result = await getStorageStatus(sandbox, createMockEnvWithR2());

    expect(result).toEqual({
      configured: true,
      lastSync: '2026-04-11T00:00:00.000Z',
      message: 'R2 storage is configured. Your data will persist across container restarts.',
    });
  });

  it('restarts the gateway by killing the existing process and re-ensuring runtime', async () => {
    const { sandbox } = createMockSandbox();
    const kill = vi.fn().mockResolvedValue(undefined);
    vi.mocked(gatewayModule.findExistingGatewayProcess).mockResolvedValue({
      id: 'gateway-1',
      kill,
    } as unknown as Awaited<ReturnType<typeof gatewayModule.findExistingGatewayProcess>>);

    const result = await restartGateway(sandbox, createMockEnv());

    expect(kill).toHaveBeenCalled();
    expect(gatewayModule.ensureGatewayRuntime).toHaveBeenCalledWith(sandbox, expect.any(Object));
    expect(result).toEqual({
      success: true,
      message: 'Gateway process killed, new instance starting...',
      previousProcessId: 'gateway-1',
    });
  });
});
