import type { Sandbox } from '@cloudflare/sandbox';
import type { MoltbotEnv } from '../types';
import { ensureGatewayRuntime } from '../gateway';
import { buildDailyHeartbeatCommand, shouldRunDailyHeartbeat } from './heartbeat';

export async function handleScheduledEvent(
  event: ScheduledEvent,
  env: MoltbotEnv,
  ctx: ExecutionContext,
  sandbox: Sandbox,
): Promise<void> {
  if (shouldRunDailyHeartbeat(event.cron)) {
    console.log('[CRON] Triggering Daily Heartbeat');
    const heartbeat = buildDailyHeartbeatCommand(env);

    ctx.waitUntil(
      sandbox
        .startProcess(heartbeat.command)
        .then(async (proc) => {
          await new Promise((r) => setTimeout(r, 5000));
          const logs = await proc.getLogs();
          console.log('[CRON] Heartbeat initialized:', logs.stdout || logs.stderr);
        })
        .catch((err: Error) => console.error('[CRON] Heartbeat trigger failed:', err)),
    );
    return;
  }

  ctx.waitUntil(
    ensureGatewayRuntime(sandbox, env)
      .then((process) => console.log('[CRON] Gateway ensured successfully', process.id))
      .catch((err: Error) => console.error('[CRON] Failed to ensure gateway:', err.message)),
  );
}
