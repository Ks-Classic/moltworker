import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ensureGatewayRuntime } from './process';
import { findExistingGatewayProcess } from './process-discovery';
import type { Sandbox, Process } from '@cloudflare/sandbox';
import { createMockEnv, createMockExecResult, createMockSandbox } from '../test-utils';

const { ensureRcloneConfigMock } = vi.hoisted(() => ({
  ensureRcloneConfigMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./r2', () => ({
  ensureRcloneConfig: ensureRcloneConfigMock,
}));

function createFullMockProcess(overrides: Partial<Process> = {}): Process {
  return {
    id: 'test-id',
    command: 'openclaw gateway',
    status: 'running',
    startTime: new Date(),
    endTime: undefined,
    exitCode: undefined,
    waitForPort: vi.fn(),
    kill: vi.fn(),
    getLogs: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
    ...overrides,
  } as Process;
}

describe('findExistingGatewayProcess', () => {
  beforeEach(() => {
    ensureRcloneConfigMock.mockClear();
  });

  it('returns null when no processes exist', async () => {
    const { sandbox } = createMockSandbox({ processes: [] });
    const result = await findExistingGatewayProcess(sandbox);
    expect(result).toBeNull();
  });

  it('returns null when only CLI commands are running', async () => {
    const processes = [
      createFullMockProcess({ command: 'openclaw devices list --json', status: 'running' }),
      createFullMockProcess({ command: 'openclaw --version', status: 'completed' }),
    ];
    const { sandbox, listProcessesMock } = createMockSandbox();
    listProcessesMock.mockResolvedValue(processes);

    const result = await findExistingGatewayProcess(sandbox);
    expect(result).toBeNull();
  });

  it('returns gateway process when running (openclaw)', async () => {
    const gatewayProcess = createFullMockProcess({
      id: 'gateway-1',
      command: 'openclaw gateway --port 18789',
      status: 'running',
    });
    const processes = [
      createFullMockProcess({ command: 'openclaw devices list', status: 'completed' }),
      gatewayProcess,
    ];
    const { sandbox, listProcessesMock } = createMockSandbox();
    listProcessesMock.mockResolvedValue(processes);

    const result = await findExistingGatewayProcess(sandbox);
    expect(result).toBe(gatewayProcess);
  });

  it('returns gateway process when starting via startup script', async () => {
    const gatewayProcess = createFullMockProcess({
      id: 'gateway-1',
      command: '/usr/local/bin/start-openclaw.sh',
      status: 'starting',
    });
    const { sandbox, listProcessesMock } = createMockSandbox();
    listProcessesMock.mockResolvedValue([gatewayProcess]);

    const result = await findExistingGatewayProcess(sandbox);
    expect(result).toBe(gatewayProcess);
  });

  it('matches legacy clawdbot gateway command (transition compat)', async () => {
    const gatewayProcess = createFullMockProcess({
      id: 'gateway-1',
      command: 'clawdbot gateway --port 18789',
      status: 'running',
    });
    const { sandbox, listProcessesMock } = createMockSandbox();
    listProcessesMock.mockResolvedValue([gatewayProcess]);

    const result = await findExistingGatewayProcess(sandbox);
    expect(result).toBe(gatewayProcess);
  });

  it('matches legacy start-moltbot.sh command (transition compat)', async () => {
    const gatewayProcess = createFullMockProcess({
      id: 'gateway-1',
      command: '/usr/local/bin/start-moltbot.sh',
      status: 'running',
    });
    const { sandbox, listProcessesMock } = createMockSandbox();
    listProcessesMock.mockResolvedValue([gatewayProcess]);

    const result = await findExistingGatewayProcess(sandbox);
    expect(result).toBe(gatewayProcess);
  });

  it('ignores completed gateway processes', async () => {
    const processes = [
      createFullMockProcess({ command: 'openclaw gateway', status: 'completed' }),
      createFullMockProcess({ command: 'start-openclaw.sh', status: 'failed' }),
    ];
    const { sandbox, listProcessesMock } = createMockSandbox();
    listProcessesMock.mockResolvedValue(processes);

    const result = await findExistingGatewayProcess(sandbox);
    expect(result).toBeNull();
  });

  it('handles listProcesses errors gracefully', async () => {
    const sandbox = {
      listProcesses: vi.fn().mockRejectedValue(new Error('Network error')),
    } as unknown as Sandbox;

    const result = await findExistingGatewayProcess(sandbox);
    expect(result).toBeNull();
  });

  it('returns first matching gateway process', async () => {
    const firstGateway = createFullMockProcess({
      id: 'gateway-1',
      command: 'openclaw gateway',
      status: 'running',
    });
    const secondGateway = createFullMockProcess({
      id: 'gateway-2',
      command: 'start-openclaw.sh',
      status: 'starting',
    });
    const { sandbox, listProcessesMock } = createMockSandbox();
    listProcessesMock.mockResolvedValue([firstGateway, secondGateway]);

    const result = await findExistingGatewayProcess(sandbox);
    expect(result?.id).toBe('gateway-1');
  });

  it('does not match openclaw onboard as a gateway process', async () => {
    const processes = [
      createFullMockProcess({ command: 'openclaw onboard --non-interactive', status: 'running' }),
    ];
    const { sandbox, listProcessesMock } = createMockSandbox();
    listProcessesMock.mockResolvedValue(processes);

    const result = await findExistingGatewayProcess(sandbox);
    expect(result).toBeNull();
  });
});

describe('ensureGatewayRuntime', () => {
  beforeEach(() => {
    ensureRcloneConfigMock.mockClear();
  });

  it('restarts an existing process when the effective primary model drifts from env', async () => {
    const gatewayProcess = createFullMockProcess({
      id: 'gateway-1',
      command: '/usr/local/bin/start-openclaw.sh',
      status: 'running',
      kill: vi.fn().mockResolvedValue(undefined),
      waitForPort: vi.fn(),
    });
    const freshProcess = createFullMockProcess({
      id: 'gateway-2',
      command: '/usr/local/bin/start-openclaw.sh',
      status: 'running',
      waitForPort: vi.fn().mockResolvedValue(undefined),
      getLogs: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
    });

    const { sandbox, containerFetchMock, execMock, startProcessMock } = createMockSandbox({
      processes: [gatewayProcess],
    });
    execMock.mockResolvedValue(
      createMockExecResult(
        JSON.stringify({
          primaryModel: 'openrouter/google/gemma-4-26b-a4b-it:free',
          gatewayToken: null,
        }),
        { success: true },
      ),
    );
    startProcessMock.mockResolvedValue(freshProcess);
    containerFetchMock.mockResolvedValue(new Response('ok', { status: 200 }));

    const env = createMockEnv({
      CF_AI_GATEWAY_MODEL: 'google-ai-studio/gemini-3.1-flash-lite-preview',
    });

    const result = await ensureGatewayRuntime(sandbox, env);

    expect(gatewayProcess.kill).toHaveBeenCalledTimes(1);
    expect(startProcessMock).toHaveBeenCalledTimes(1);
    expect(result).toBe(freshProcess);
  });

  it('keeps an existing process when the effective primary model matches env', async () => {
    const gatewayProcess = createFullMockProcess({
      id: 'gateway-1',
      command: '/usr/local/bin/start-openclaw.sh',
      status: 'running',
      kill: vi.fn().mockResolvedValue(undefined),
      waitForPort: vi.fn().mockResolvedValue(undefined),
    });

    const { sandbox, containerFetchMock, execMock, startProcessMock } = createMockSandbox({
      processes: [gatewayProcess],
    });
    execMock.mockResolvedValue(
      createMockExecResult(
        JSON.stringify({
          primaryModel: 'google/gemini-3.1-flash-lite-preview',
          gatewayToken: null,
        }),
        { success: true },
      ),
    );
    containerFetchMock.mockResolvedValue(new Response('ok', { status: 200 }));

    const env = createMockEnv({
      CF_AI_GATEWAY_MODEL: 'google-ai-studio/gemini-3.1-flash-lite-preview',
    });

    const result = await ensureGatewayRuntime(sandbox, env);

    expect(gatewayProcess.kill).not.toHaveBeenCalled();
    expect(startProcessMock).not.toHaveBeenCalled();
    expect(result).toBe(gatewayProcess);
  });

  it('waits for an existing starting process when runtime-state says startup is in progress', async () => {
    const gatewayProcess = createFullMockProcess({
      id: 'gateway-1',
      command: '/usr/local/bin/start-openclaw.sh',
      status: 'starting',
      kill: vi.fn().mockResolvedValue(undefined),
    });

    const { sandbox, containerFetchMock, execMock, startProcessMock } = createMockSandbox({
      processes: [gatewayProcess],
    });
    execMock
      .mockResolvedValueOnce(
        createMockExecResult(
          JSON.stringify({
            primaryModel: null,
            gatewayToken: null,
          }),
          { success: true },
        ),
      )
      .mockResolvedValueOnce(
        createMockExecResult(
          JSON.stringify({
            phase: 'gateway-starting',
            status: 'starting',
            updatedAt: new Date().toISOString(),
          }),
          { success: true },
        ),
      );
    containerFetchMock
      .mockRejectedValueOnce(new Error('not ready'))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const env = createMockEnv({});

    const result = await ensureGatewayRuntime(sandbox, env);

    expect(startProcessMock).not.toHaveBeenCalled();
    expect(result).toBe(gatewayProcess);
  });

  it('restarts an unhealthy existing process when runtime-state is degraded and HTTP is down', async () => {
    const gatewayProcess = createFullMockProcess({
      id: 'gateway-1',
      command: '/usr/local/bin/start-openclaw.sh',
      status: 'running',
      kill: vi.fn().mockResolvedValue(undefined),
      waitForPort: vi.fn(),
    });
    const freshProcess = createFullMockProcess({
      id: 'gateway-2',
      command: '/usr/local/bin/start-openclaw.sh',
      status: 'running',
      waitForPort: vi.fn().mockResolvedValue(undefined),
      getLogs: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
    });

    const { sandbox, containerFetchMock, execMock, startProcessMock } = createMockSandbox({
      processes: [gatewayProcess],
    });
    execMock
      .mockResolvedValueOnce(
        createMockExecResult(
          JSON.stringify({
            primaryModel: null,
            gatewayToken: null,
          }),
          { success: true },
        ),
      )
      .mockResolvedValueOnce(
        createMockExecResult(
          JSON.stringify({
            phase: 'gateway-exited',
            status: 'degraded',
          }),
          { success: true },
        ),
      );
    containerFetchMock
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    startProcessMock.mockResolvedValue(freshProcess);

    const env = createMockEnv({});

    const result = await ensureGatewayRuntime(sandbox, env);

    expect(gatewayProcess.kill).toHaveBeenCalledTimes(1);
    expect(startProcessMock).toHaveBeenCalledTimes(1);
    expect(result).toBe(freshProcess);
  });

  it('restarts an existing process when the effective gateway token drifts from env', async () => {
    const gatewayProcess = createFullMockProcess({
      id: 'gateway-1',
      command: '/usr/local/bin/start-openclaw.sh',
      status: 'running',
      kill: vi.fn().mockResolvedValue(undefined),
      waitForPort: vi.fn(),
    });
    const freshProcess = createFullMockProcess({
      id: 'gateway-2',
      command: '/usr/local/bin/start-openclaw.sh',
      status: 'running',
      waitForPort: vi.fn().mockResolvedValue(undefined),
      getLogs: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
    });

    const { sandbox, containerFetchMock, execMock, startProcessMock } = createMockSandbox({
      processes: [gatewayProcess],
    });
    execMock.mockResolvedValue(
      createMockExecResult(
        JSON.stringify({
          primaryModel: null,
          gatewayToken: 'old-token',
        }),
        { success: true },
      ),
    );
    startProcessMock.mockResolvedValue(freshProcess);
    containerFetchMock.mockResolvedValue(new Response('ok', { status: 200 }));

    const env = createMockEnv({
      MOLTBOT_GATEWAY_TOKEN: 'new-token',
    });

    const result = await ensureGatewayRuntime(sandbox, env);

    expect(gatewayProcess.kill).toHaveBeenCalledTimes(1);
    expect(startProcessMock).toHaveBeenCalledTimes(1);
    expect(result).toBe(freshProcess);
  });

  it('restarts an existing process when the effective gateway token remains after env removal', async () => {
    const gatewayProcess = createFullMockProcess({
      id: 'gateway-1',
      command: '/usr/local/bin/start-openclaw.sh',
      status: 'running',
      kill: vi.fn().mockResolvedValue(undefined),
      waitForPort: vi.fn(),
    });
    const freshProcess = createFullMockProcess({
      id: 'gateway-2',
      command: '/usr/local/bin/start-openclaw.sh',
      status: 'running',
      waitForPort: vi.fn().mockResolvedValue(undefined),
      getLogs: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
    });

    const { sandbox, containerFetchMock, execMock, startProcessMock } = createMockSandbox({
      processes: [gatewayProcess],
    });
    execMock.mockResolvedValue(
      createMockExecResult(
        JSON.stringify({
          primaryModel: null,
          gatewayToken: 'old-token',
        }),
        { success: true },
      ),
    );
    startProcessMock.mockResolvedValue(freshProcess);
    containerFetchMock.mockResolvedValue(new Response('ok', { status: 200 }));

    const env = createMockEnv({});

    const result = await ensureGatewayRuntime(sandbox, env);

    expect(gatewayProcess.kill).toHaveBeenCalledTimes(1);
    expect(startProcessMock).toHaveBeenCalledTimes(1);
    expect(result).toBe(freshProcess);
  });
});
