import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { createAccessMiddleware, createOwnerMiddleware } from '../auth';
import { debug } from './debug';
import { createMockEnv, createMockSandbox, suppressConsole } from '../test-utils';

describe('debug route auth boundary', () => {
  beforeEach(() => {
    suppressConsole();
  });

  it('returns auth failure instead of falling through to the gateway proxy', async () => {
    const { sandbox, containerFetchMock } = createMockSandbox();
    const env = createMockEnv({
      DEBUG_ROUTES: 'true',
      CF_ACCESS_TEAM_DOMAIN: 'example.cloudflareaccess.com',
      CF_ACCESS_AUD: 'audience',
      ADMIN_ALLOWED_EMAILS: 'owner@example.com',
    });

    const app = new Hono<AppEnv>();

    app.use('*', async (c, next) => {
      c.set('sandbox', sandbox);
      c.env = env;
      await next();
    });

    app.use('*', createAccessMiddleware({ type: 'json' }));
    app.use('/debug/*', async (c, next) => {
      if (c.env.DEBUG_ROUTES !== 'true') {
        return c.json({ error: 'Debug routes are disabled' }, 404);
      }
      return next();
    });
    app.use('/debug/*', createOwnerMiddleware({ type: 'json' }));
    app.route('/debug', debug);

    app.all('*', async (c) => {
      const response = await c.get('sandbox').containerFetch(c.req.raw, 18789);
      return response;
    });

    const response = await app.fetch(
      new Request('http://localhost/debug/runtime-state', {
        headers: {
          Accept: 'application/json',
        },
      }),
      env,
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: 'Unauthorized',
      hint: 'Missing Cloudflare Access JWT. Ensure this route is protected by Cloudflare Access.',
    });
    expect(containerFetchMock).not.toHaveBeenCalled();
  });
});
