import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { publicRoutes } from './public';
import { createMockEnv, createMockSandbox } from '../test-utils';

describe('public routes', () => {
  it('reports moltworker as the public service while preserving the legacy service name', async () => {
    const { sandbox } = createMockSandbox();
    const env = createMockEnv();
    const app = new Hono<AppEnv>();

    app.use('*', async (c, next) => {
      c.set('sandbox', sandbox);
      c.env = env;
      await next();
    });
    app.route('/', publicRoutes);

    const response = await app.fetch(new Request('http://localhost/sandbox-health'), env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: 'ok',
      service: 'moltworker',
      gatewayRuntime: 'openclaw',
      legacyServiceName: 'moltbot-sandbox',
      gateway_port: 18789,
    });
  });
});
