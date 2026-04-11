import type { Sandbox, Process } from '@cloudflare/sandbox';
import type { MoltbotEnv } from '../types';
import { STARTUP_TIMEOUT_MS } from '../config';
import { buildEnvVars } from './env';
import { findExistingGatewayProcess } from './process-discovery';
import { ensureRcloneConfig } from './r2';
import { isRuntimeStateStarting, probeGatewayHttp, readRuntimeState } from './runtime-state';
import { buildDesiredRuntimeSpec } from './runtime-spec';
import { findExistingGatewayProcess as findExistingMoltbotProcess } from './process-discovery';

interface EffectiveGatewayConfig {
  primaryModel: string | null;
  gatewayToken: string | null;
}

async function readEffectiveGatewayConfig(sandbox: Sandbox): Promise<EffectiveGatewayConfig | null> {
  const result = await sandbox.exec(
    `node -e "const fs=require('fs'); const config=JSON.parse(fs.readFileSync('/root/.openclaw/openclaw.json','utf8')); process.stdout.write(JSON.stringify({primaryModel: config?.agents?.defaults?.model?.primary || null, gatewayToken: config?.gateway?.auth?.token || null}))"`,
    { timeout: 10000 },
  );

  if (!result.success) {
    return null;
  }

  const stdout = (result.stdout || '').trim();
  if (!stdout) {
    return null;
  }

  try {
    const parsed = JSON.parse(stdout) as Partial<EffectiveGatewayConfig>;
    return {
      primaryModel: parsed.primaryModel ?? null,
      gatewayToken: parsed.gatewayToken ?? null,
    };
  } catch {
    return null;
  }
}

async function waitForGatewayHttpReady(sandbox: Sandbox, timeoutMs: number): Promise<boolean> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const gatewayHttp = await probeGatewayHttp(sandbox);
    if (gatewayHttp.ok) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return false;
}

async function waitForGatewayHealthy(sandbox: Sandbox, timeoutMs: number): Promise<boolean> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const [runtime, gatewayHttp] = await Promise.all([
      readRuntimeState(sandbox),
      probeGatewayHttp(sandbox),
    ]);

    if (gatewayHttp.ok) {
      return true;
    }

    if (runtime?.status === 'degraded' || runtime?.phase === 'gateway-exited' || runtime?.phase === 'gateway-timeout') {
      return false;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return false;
}

/**
 * Ensure the OpenClaw gateway is running
 *
 * This will:
 * 1. Mount R2 storage if configured
 * 2. Check for an existing gateway process
 * 3. Wait for it to be ready, or start a new one
 *
 * @param sandbox - The sandbox instance
 * @param env - Worker environment bindings
 * @returns The running gateway process
 */
export async function ensureGatewayRuntime(sandbox: Sandbox, env: MoltbotEnv): Promise<Process> {
  // Configure rclone for R2 persistence (non-blocking if not configured).
  // The startup script uses rclone to restore data from R2 on boot.
  await ensureRcloneConfig(sandbox, env);

  const desiredRuntime = buildDesiredRuntimeSpec(env);
  let startReason = 'cold-start';

  // Check if gateway is already running or starting
  const existingProcess = await findExistingGatewayProcess(sandbox);
  if (existingProcess) {
    console.log(
      'Found existing gateway process:',
      existingProcess.id,
      'status:',
      existingProcess.status,
    );

    let restartRequired = false;
    try {
      const effectiveConfig = await readEffectiveGatewayConfig(sandbox);
      if (!effectiveConfig) {
        console.log('Could not read effective gateway config from openclaw.json');
      } else {
        const { primaryModel: effectivePrimaryModel, gatewayToken: effectiveGatewayToken } =
          effectiveConfig;

        if (desiredRuntime.primaryModel && effectivePrimaryModel !== desiredRuntime.primaryModel) {
          console.log(
            'Gateway model drift detected, restarting process:',
            existingProcess.id,
            'effective model:',
            effectivePrimaryModel,
            'desired model:',
            desiredRuntime.primaryModel,
          );
          await existingProcess.kill();
          restartRequired = true;
          startReason = 'config-drift:model';
        } else if (desiredRuntime.primaryModel) {
          console.log('Gateway primary model matches desired env:', desiredRuntime.primaryModel);
        }

        if (!restartRequired && effectiveGatewayToken !== desiredRuntime.gatewayToken) {
          console.log(
            'Gateway token drift detected, restarting process:',
            existingProcess.id,
            'effective token configured:',
            effectiveGatewayToken !== null,
            'desired token configured:',
            desiredRuntime.gatewayTokenConfigured,
          );
          await existingProcess.kill();
          restartRequired = true;
          startReason = 'config-drift:token';
        } else if (!restartRequired) {
          console.log('Gateway token matches desired env');
        }
      }
    } catch (driftError) {
      console.log('Failed to check gateway config drift:', driftError);
    }

    if (restartRequired) {
      console.log('Existing gateway process killed due to config drift, starting fresh');
    } else {
      const gatewayHttp = await probeGatewayHttp(sandbox);
      if (gatewayHttp.ok) {
        console.log('Existing gateway is already serving HTTP');
        return existingProcess;
      }

      const runtime = await readRuntimeState(sandbox);
      const shouldWaitForExisting =
        isRuntimeStateStarting(runtime) ||
        (!runtime && existingProcess.status === 'starting');

      if (shouldWaitForExisting) {
        console.log('Waiting for existing gateway to finish startup');
        const becameHealthy = await waitForGatewayHealthy(sandbox, STARTUP_TIMEOUT_MS);
        if (becameHealthy) {
          console.log('Existing gateway became healthy');
          return existingProcess;
        }
      }

      console.log('Existing process is not healthy, killing and restarting...');
      try {
        await existingProcess.kill();
        startReason = 'unhealthy-runtime';
      } catch (killError) {
        console.log('Failed to kill process:', killError);
      }
    }
  }

  // Start a new OpenClaw gateway
  console.log('Starting new OpenClaw gateway...');
  const envVars = buildEnvVars(env);
  envVars.OPENCLAW_DESIRED_RUNTIME_FINGERPRINT = desiredRuntime.fingerprint;
  envVars.OPENCLAW_RESTART_REASON = startReason;
  const command = '/usr/local/bin/start-openclaw.sh';

  console.log('Starting process with command:', command);
  console.log('Environment vars being passed:', Object.keys(envVars));

  let process: Process;
  try {
    process = await sandbox.startProcess(command, {
      env: Object.keys(envVars).length > 0 ? envVars : undefined,
    });
    console.log('Process started with id:', process.id, 'status:', process.status);
  } catch (startErr) {
    console.error('Failed to start process:', startErr);
    throw startErr;
  }

  // Wait for the gateway to be ready
  try {
    console.log('[Gateway] Waiting for OpenClaw gateway to become healthy via runtime-state and HTTP');
    const becameHealthy = await waitForGatewayHealthy(sandbox, STARTUP_TIMEOUT_MS);
    if (!becameHealthy) {
      const gatewayHttp = await waitForGatewayHttpReady(sandbox, 10_000);
      if (!gatewayHttp) {
        throw new Error('OpenClaw gateway did not become healthy');
      }
    }
    console.log('[Gateway] OpenClaw gateway is ready!');

    const logs = await process.getLogs();
    if (logs.stdout) console.log('[Gateway] stdout:', logs.stdout);
    if (logs.stderr) console.log('[Gateway] stderr:', logs.stderr);
  } catch (e) {
    console.error('[Gateway] health wait failed:', e);
    try {
      const logs = await process.getLogs();
      console.error('[Gateway] startup failed. Stderr:', logs.stderr);
      console.error('[Gateway] startup failed. Stdout:', logs.stdout);
      throw new Error(`OpenClaw gateway failed to start. Stderr: ${logs.stderr || '(empty)'}`, {
        cause: e,
      });
    } catch (logErr) {
      console.error('[Gateway] Failed to get logs:', logErr);
      throw e;
    }
  }

  // Verify gateway is actually responding
  console.log('[Gateway] Verifying gateway health...');

  return process;
}

// Backward-compatible alias while the rest of the codebase migrates away from
// legacy Moltbot naming.
export const ensureMoltbotGateway = ensureGatewayRuntime;
export { findExistingMoltbotProcess };
