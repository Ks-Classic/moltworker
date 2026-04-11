import { Hono } from 'hono';
import type { AppEnv } from '../types';
import {
  GATEWAY_RUNTIME_NAME,
  LEGACY_WORKER_SERVICE_NAME,
  MOLTBOT_PORT,
  WORKER_RUNTIME_NAME,
} from '../config';
import { getGatewayLifecycleState, getGatewayRuntimeStatus, isGatewayReady } from '../gateway';

/**
 * Public routes - NO Cloudflare Access authentication required
 *
 * These routes are mounted BEFORE the auth middleware is applied.
 * Includes: health checks, static assets, and public API endpoints.
 */
const publicRoutes = new Hono<AppEnv>();

// GET /sandbox-health - Health check endpoint
publicRoutes.get('/sandbox-health', (c) => {
  return c.json({
    status: 'ok',
    service: WORKER_RUNTIME_NAME,
    gatewayRuntime: GATEWAY_RUNTIME_NAME,
    legacyServiceName: LEGACY_WORKER_SERVICE_NAME,
    gateway_port: MOLTBOT_PORT,
  });
});

// GET /logo.png - Serve logo from ASSETS binding
publicRoutes.get('/logo.png', (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

// GET /logo-small.png - Serve small logo from ASSETS binding
publicRoutes.get('/logo-small.png', (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

// GET /api/status - Public health check for gateway status (no auth required)
publicRoutes.get('/api/status', async (c) => {
  const sandbox = c.get('sandbox');

  try {
    const status = await getGatewayRuntimeStatus(sandbox);
    return c.json({
      ok: isGatewayReady(status),
      status: getGatewayLifecycleState(status),
      runtimeFresh: status.runtimeFresh,
      runtimeAgeMs: status.runtimeAgeMs,
    });
  } catch (err) {
    return c.json({
      ok: false,
      status: 'error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

// GET /_admin/assets/* - Admin UI static assets (CSS, JS need to load for login redirect)
// Assets are built to dist/client with base "/_admin/"
publicRoutes.get('/_admin/assets/*', async (c) => {
  const url = new URL(c.req.url);
  // Rewrite /_admin/assets/* to /assets/* for the ASSETS binding
  const assetPath = url.pathname.replace('/_admin/assets/', '/assets/');
  const assetUrl = new URL(assetPath, url.origin);
  return c.env.ASSETS.fetch(new Request(assetUrl.toString(), c.req.raw));
});

export { publicRoutes };
