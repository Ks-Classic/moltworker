import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../types';
import {
  createMockEnv,
  createMockProcess,
  createMockSandbox,
  suppressConsole,
} from '../test-utils';
import { api } from './api';
import { verifyAccessJWT } from '../auth/jwt';
import * as gatewayModule from '../gateway';

vi.mock('../auth/jwt', () => ({
  verifyAccessJWT: vi.fn(),
}));

vi.mock('../gateway', () => ({
  ensureGatewayRuntime: vi.fn(),
  findExistingGatewayProcess: vi.fn(),
  syncToR2: vi.fn(),
  waitForProcess: vi.fn(),
}));

function createApiApp(envOverrides: Partial<AppEnv['Bindings']> = {}) {
  const { sandbox, startProcessMock } = createMockSandbox();
  const env = createMockEnv({
    CF_ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com',
    CF_ACCESS_AUD: 'aud123',
    MOLTBOT_GATEWAY_TOKEN: 'gateway-token',
    ...envOverrides,
  });

  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('sandbox', sandbox);
    c.env = env;
    await next();
  });
  app.route('/api', api);

  return { app, env, startProcessMock };
}

function createAccessRequest(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('CF-Access-JWT-Assertion', 'header.payload.signature');

  return new Request(`http://localhost${path}`, {
    ...init,
    headers,
  });
}

describe('Admin API permissions', () => {
  beforeEach(() => {
    suppressConsole();
    vi.clearAllMocks();
    vi.mocked(verifyAccessJWT).mockResolvedValue({
      aud: ['aud123'],
      email: 'viewer@example.com',
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
      iss: 'https://team.cloudflareaccess.com',
      name: 'Viewer User',
      sub: 'user-123',
      type: 'app',
    });
    vi.mocked(gatewayModule.ensureGatewayRuntime).mockResolvedValue(
      createMockProcess() as Awaited<ReturnType<typeof gatewayModule.ensureGatewayRuntime>>,
    );
    vi.mocked(gatewayModule.waitForProcess).mockResolvedValue(undefined);
  });

  it('returns the current session with read-only capability for non-allowlisted users', async () => {
    const { app, env } = createApiApp();

    const response = await app.fetch(createAccessRequest('/api/admin/session'), env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      accessUser: {
        email: 'viewer@example.com',
        name: 'Viewer User',
      },
      canManage: false,
    });
  });

  it('allows non-allowlisted users to read device status', async () => {
    const { app, env, startProcessMock } = createApiApp();
    startProcessMock.mockResolvedValue(
      createMockProcess('{"pending":[{"requestId":"req-1"}],"paired":[]}\n'),
    );

    const response = await app.fetch(createAccessRequest('/api/admin/devices'), env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      pending: [{ requestId: 'req-1' }],
      paired: [],
    });
    expect(gatewayModule.ensureGatewayRuntime).toHaveBeenCalled();
  });

  it('keeps approval actions restricted to allowlisted users', async () => {
    const { app, env } = createApiApp({
      ADMIN_ALLOWED_EMAILS: 'owner@example.com',
    });

    const response = await app.fetch(
      createAccessRequest('/api/admin/devices/req-1/approve', { method: 'POST' }),
      env,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: 'Forbidden',
      hint: 'This route is restricted to configured allowlisted admin accounts',
    });
  });

  it('allows allowlisted users to approve devices', async () => {
    vi.mocked(verifyAccessJWT).mockResolvedValue({
      aud: ['aud123'],
      email: 'owner@example.com',
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
      iss: 'https://team.cloudflareaccess.com',
      name: 'Owner User',
      sub: 'user-456',
      type: 'app',
    });

    const { app, env, startProcessMock } = createApiApp({
      ADMIN_ALLOWED_EMAILS: 'owner@example.com',
    });
    startProcessMock.mockResolvedValue(createMockProcess('Approved req-1\n'));

    const response = await app.fetch(
      createAccessRequest('/api/admin/devices/req-1/approve', { method: 'POST' }),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      requestId: 'req-1',
      message: 'Device approved',
    });
  });
});
