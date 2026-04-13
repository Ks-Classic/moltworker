import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { createAccessMiddleware, createOwnerMiddleware, hasOwnerAccess } from '../auth';
import {
  type AdminCommandError,
  approveAllDevices,
  approveDevice,
  getConfigDiffSummary,
  getStorageStatus,
  listConfigSnapshots,
  listDevices,
  restartGateway,
  rollbackConfigSnapshot,
  triggerStorageSync,
  updateDiscordMentionMode,
} from '../admin/service';

/**
 * API routes
 * - /api/admin/* - Protected admin API routes (Cloudflare Access required)
 *
 * Note: /api/status is now handled by publicRoutes (no auth required)
 */
const api = new Hono<AppEnv>();

/**
 * Admin API routes - all protected by Cloudflare Access
 */
const adminApi = new Hono<AppEnv>();

function isAdminCommandError(result: AdminCommandError | object): result is AdminCommandError {
  return 'error' in result;
}

// Middleware: Verify Cloudflare Access JWT for all admin routes
adminApi.use('*', createAccessMiddleware({ type: 'json' }));
const ownerOnlyJson = createOwnerMiddleware({ type: 'json' });

// GET /api/admin/session - Return the current Cloudflare Access user and capabilities
adminApi.get('/session', (c) => {
  const accessUser = c.get('accessUser');

  return c.json({
    accessUser: accessUser || null,
    canManage: hasOwnerAccess(c.env, accessUser?.email),
  });
});

// GET /api/admin/config/diff - Show source/override/generated config drift
adminApi.get('/config/diff', ownerOnlyJson, async (c) => {
  const sandbox = c.get('sandbox');

  try {
    const summary = await getConfigDiffSummary(sandbox);
    return c.json(summary);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: errorMessage }, 500);
  }
});

// GET /api/admin/config/snapshots - List stored config snapshots
adminApi.get('/config/snapshots', ownerOnlyJson, async (c) => {
  const sandbox = c.get('sandbox');

  try {
    const result = await listConfigSnapshots(sandbox);
    const status = isAdminCommandError(result) ? 500 : 200;
    return c.json(result, status);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: errorMessage }, 500);
  }
});

// POST /api/admin/config/rollback - Restore a saved config snapshot
adminApi.post('/config/rollback', ownerOnlyJson, async (c) => {
  const sandbox = c.get('sandbox');

  try {
    const body = await c.req.json<{ snapshotId?: string }>();
    if (body.snapshotId && !/^[A-Za-z0-9-]+$/.test(body.snapshotId)) {
      return c.json({ error: 'snapshotId contains invalid characters' }, 400);
    }

    const result = await rollbackConfigSnapshot(sandbox, body.snapshotId);
    const status = isAdminCommandError(result) ? 500 : 200;
    return c.json(result, status);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: errorMessage }, 500);
  }
});

// GET /api/admin/devices - List pending and paired devices
adminApi.get('/devices', async (c) => {
  const sandbox = c.get('sandbox');

  try {
    return c.json(await listDevices(sandbox, c.env));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: errorMessage }, 500);
  }
});

// POST /api/admin/devices/:requestId/approve - Approve a pending device
adminApi.post('/devices/:requestId/approve', ownerOnlyJson, async (c) => {
  const sandbox = c.get('sandbox');
  const requestId = c.req.param('requestId');

  if (!requestId) {
    return c.json({ error: 'requestId is required' }, 400);
  }

  try {
    return c.json(await approveDevice(sandbox, c.env, requestId));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: errorMessage }, 500);
  }
});

// POST /api/admin/devices/approve-all - Approve all pending devices
adminApi.post('/devices/approve-all', ownerOnlyJson, async (c) => {
  const sandbox = c.get('sandbox');

  try {
    const result = await approveAllDevices(sandbox, c.env);
    const status = isAdminCommandError(result) ? 500 : 200;
    return c.json(result, status);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: errorMessage }, 500);
  }
});

// GET /api/admin/storage - Get R2 storage status and last sync time
adminApi.get('/storage', async (c) => {
  const sandbox = c.get('sandbox');
  return c.json(await getStorageStatus(sandbox, c.env));
});

// POST /api/admin/storage/sync - Trigger a manual sync to R2
adminApi.post('/storage/sync', ownerOnlyJson, async (c) => {
  const sandbox = c.get('sandbox');

  const result = await triggerStorageSync(sandbox, c.env);

  if (result && typeof result === 'object' && 'success' in result && result.success === false) {
    const status =
      'error' in result &&
      typeof result.error === 'string' &&
      result.error.includes('not configured')
        ? 400
        : 500;
    return c.json(result, status);
  }

  return c.json(result);
});

// POST /api/admin/config/discord/mention-mode - Persist guild/channel mention policy
adminApi.post('/config/discord/mention-mode', ownerOnlyJson, async (c) => {
  const sandbox = c.get('sandbox');

  try {
    const body = await c.req.json<{
      guildId?: string;
      channelId?: string;
      requireMention?: boolean;
    }>();

    if (!body.guildId || typeof body.requireMention !== 'boolean') {
      return c.json({ error: 'guildId and requireMention are required' }, 400);
    }

    if (!/^\d+$/.test(body.guildId)) {
      return c.json({ error: 'guildId must be a Discord snowflake' }, 400);
    }

    if (body.channelId && !/^\d+$/.test(body.channelId)) {
      return c.json({ error: 'channelId must be a Discord snowflake' }, 400);
    }

    return c.json(
      await updateDiscordMentionMode(sandbox, {
        guildId: body.guildId,
        channelId: body.channelId,
        requireMention: body.requireMention,
      }),
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: errorMessage }, 500);
  }
});

// POST /api/admin/gateway/restart - Kill the current gateway and start a new one
adminApi.post('/gateway/restart', ownerOnlyJson, async (c) => {
  const sandbox = c.get('sandbox');

  try {
    const restartPromise = restartGateway(sandbox, c.env);
    c.executionCtx.waitUntil(restartPromise.then(() => undefined));
    return c.json(await restartPromise);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: errorMessage }, 500);
  }
});

// Mount admin API routes under /admin
api.route('/admin', adminApi);

export { api };
