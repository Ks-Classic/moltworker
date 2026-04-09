import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { debug } from './debug';
import {
  createMockSandbox,
  createMockEnv,
  suppressConsole,
  createMockProcess,
} from '../test-utils';
import * as gatewayModule from '../gateway';

describe('Debug Routes - /debug/security', () => {
  beforeEach(() => {
    suppressConsole();
    // Use fake timers to bypass sleep in test if necessary
    vi.useFakeTimers();
    // Important: since waitForProcess is imported in debug.ts from '../gateway', we might want to mock it to resolve immediately,
    // or just ensure the mocked process gets 'completed' status immediately without sleeping.
    // The provided createMockProcess from test-utils defaults to status='completed'.
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('handles missing alerts and stopped status', async () => {
    const { sandbox, startProcessMock } = createMockSandbox();

    startProcessMock.mockImplementation(async (cmd: string) => {
      if (cmd.includes('security-alerts-pending.log')) {
        return createMockProcess('NO_ALERTS\n');
      }
      if (cmd.includes('pgrep -f security-monitor.sh')) {
        return createMockProcess('STOPPED\n');
      }
      if (cmd.includes('tail -50 /tmp/security-monitor.log')) {
        return createMockProcess('NO_LOG\n');
      }
      return createMockProcess();
    });

    const env = createMockEnv();

    // Setup Hono app with the mock sandbox
    const app = new Hono<AppEnv>();
    app.use('*', async (c, next) => {
      c.set('sandbox', sandbox);
      c.env = env;
      await next();
    });
    app.route('/debug', debug);

    const req = new Request('http://localhost/debug/security');
    const res = await app.fetch(req, env);
    expect(res.status).toBe(200);

    const body = (await res.json()) as any;
    expect(body).toEqual({
      status: 'STOPPED',
      alert_count: 0,
      alerts: [],
      has_critical: false,
      recent_log: 'NO_LOG',
    });
  });

  it('handles pending alerts and running status', async () => {
    const { sandbox, startProcessMock } = createMockSandbox();

    startProcessMock.mockImplementation(async (cmd: string) => {
      if (cmd.includes('security-alerts-pending.log')) {
        return createMockProcess(
          '[CRITICAL] Unauthorized file access detected\n[WARNING] Suspicious network activity\n',
        );
      }
      if (cmd.includes('pgrep -f security-monitor.sh')) {
        return createMockProcess('RUNNING\n');
      }
      if (cmd.includes('tail -50 /tmp/security-monitor.log')) {
        return createMockProcess('[INFO] Monitor started\n');
      }
      return createMockProcess();
    });

    const env = createMockEnv();
    const app = new Hono<AppEnv>();
    app.use('*', async (c, next) => {
      c.set('sandbox', sandbox);
      c.env = env;
      await next();
    });
    app.route('/debug', debug);

    const req = new Request('http://localhost/debug/security');
    const res = await app.fetch(req, env);
    expect(res.status).toBe(200);

    const body = (await res.json()) as any;
    expect(body).toEqual({
      status: 'RUNNING',
      alert_count: 2,
      alerts: [
        '[CRITICAL] Unauthorized file access detected',
        '[WARNING] Suspicious network activity',
      ],
      has_critical: true,
      recent_log: '[INFO] Monitor started',
    });
  });

  it('clears alerts when ?clear=true is passed', async () => {
    const { sandbox, startProcessMock } = createMockSandbox();

    startProcessMock.mockImplementation(async (cmd: string) => {
      if (cmd.includes('security-alerts-pending.log')) {
        return createMockProcess('[WARNING] some alert\n');
      }
      if (cmd.includes('rm -f /tmp/security-alerts-pending.log')) {
        return createMockProcess();
      }
      return createMockProcess('');
    });

    const env = createMockEnv();
    const app = new Hono<AppEnv>();
    app.use('*', async (c, next) => {
      c.set('sandbox', sandbox);
      c.env = env;
      await next();
    });
    app.route('/debug', debug);

    const req = new Request('http://localhost/debug/security?clear=true');
    const res = await app.fetch(req, env);
    expect(res.status).toBe(200);

    const body = (await res.json()) as any;
    expect(body.alert_count).toBe(1);

    // Verify clear command was called
    const cmds = startProcessMock.mock.calls.map((call) => call[0]);
    expect(cmds).toContain('rm -f /tmp/security-alerts-pending.log');
  });
});
