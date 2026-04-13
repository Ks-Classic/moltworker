import { describe, expect, it, vi, beforeEach } from 'vitest';
import { handleScheduledEvent } from './scheduled';
import {
  createMockEnv,
  createMockProcess,
  createMockSandbox,
  suppressConsole,
} from '../test-utils';
import * as gatewayModule from '../gateway';

vi.mock('../gateway', () => ({
  ensureGatewayRuntime: vi.fn(),
}));

function createMockExecutionContext() {
  return {
    waitUntil: vi.fn(),
  } as unknown as ExecutionContext;
}

function createScheduledEvent(cron: string): ScheduledEvent {
  return {
    cron,
    scheduledTime: Date.now(),
    noRetry: () => {},
  } as unknown as ScheduledEvent;
}

describe('handleScheduledEvent', () => {
  beforeEach(() => {
    suppressConsole();
    vi.clearAllMocks();
  });

  it('triggers the heartbeat command on the daily heartbeat cron', async () => {
    const { sandbox, startProcessMock } = createMockSandbox();
    const ctx = createMockExecutionContext();
    startProcessMock.mockResolvedValue(
      createMockProcess('heartbeat started', { status: 'running' }),
    );

    await handleScheduledEvent(createScheduledEvent('0 23 * * *'), createMockEnv(), ctx, sandbox);

    expect(startProcessMock).toHaveBeenCalledTimes(1);
    expect(String(startProcessMock.mock.calls[0]?.[0])).toContain('openclaw agent --agent main');
    expect(ctx.waitUntil).toHaveBeenCalledTimes(1);
    expect(gatewayModule.ensureGatewayRuntime).not.toHaveBeenCalled();
  });

  it('ensures the gateway runtime on non-heartbeat cron events', async () => {
    const { sandbox } = createMockSandbox();
    const ctx = createMockExecutionContext();
    vi.mocked(gatewayModule.ensureGatewayRuntime).mockResolvedValue({ id: 'gateway-1' } as Awaited<
      ReturnType<typeof gatewayModule.ensureGatewayRuntime>
    >);

    await handleScheduledEvent(createScheduledEvent('*/5 * * * *'), createMockEnv(), ctx, sandbox);

    expect(gatewayModule.ensureGatewayRuntime).toHaveBeenCalledWith(sandbox, expect.any(Object));
    expect(ctx.waitUntil).toHaveBeenCalledTimes(1);
  });
});
