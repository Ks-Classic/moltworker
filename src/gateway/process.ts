import type { Sandbox, Process } from '@cloudflare/sandbox';
import type { MoltbotEnv } from '../types';
import { MOLTBOT_PORT, STARTUP_TIMEOUT_MS } from '../config';
import { buildEnvVars } from './env';
import { ensureRcloneConfig } from './r2';

interface EffectiveGatewayConfig {
  primaryModel: string | null;
  gatewayToken: string | null;
}

function getDesiredPrimaryModel(env: MoltbotEnv): string | null {
  const raw = env.CF_AI_GATEWAY_MODEL;
  if (!raw) return null;

  const slashIdx = raw.indexOf('/');
  if (slashIdx <= 0) return null;

  const provider = raw.substring(0, slashIdx);
  const modelId = raw.substring(slashIdx + 1);

  if (provider === 'google-ai-studio') {
    return `google/${modelId}`;
  }

  return `cf-ai-gw-${provider}/${modelId}`;
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

/**
 * Find an existing OpenClaw gateway process
 *
 * @param sandbox - The sandbox instance
 * @returns The process if found and running/starting, null otherwise
 */
export async function findExistingMoltbotProcess(sandbox: Sandbox): Promise<Process | null> {
  try {
    const processes = await sandbox.listProcesses();
    for (const proc of processes) {
      // Match gateway process (openclaw gateway or legacy clawdbot gateway)
      // Don't match CLI commands like "openclaw devices list"
      const isGatewayProcess =
        proc.command.includes('start-openclaw.sh') ||
        proc.command.includes('openclaw gateway') ||
        // Legacy: match old startup script during transition
        proc.command.includes('start-moltbot.sh') ||
        proc.command.includes('clawdbot gateway');
      const isCliCommand =
        proc.command.includes('openclaw devices') ||
        proc.command.includes('openclaw --version') ||
        proc.command.includes('openclaw onboard') ||
        proc.command.includes('clawdbot devices') ||
        proc.command.includes('clawdbot --version');

      if (isGatewayProcess && !isCliCommand) {
        if (proc.status === 'starting' || proc.status === 'running') {
          return proc;
        }
      }
    }
  } catch (e) {
    console.log('Could not list processes:', e);
  }
  return null;
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
export async function ensureMoltbotGateway(sandbox: Sandbox, env: MoltbotEnv): Promise<Process> {
  // Configure rclone for R2 persistence (non-blocking if not configured).
  // The startup script uses rclone to restore data from R2 on boot.
  await ensureRcloneConfig(sandbox, env);

  // Check if gateway is already running or starting
  const existingProcess = await findExistingMoltbotProcess(sandbox);
  if (existingProcess) {
    console.log(
      'Found existing gateway process:',
      existingProcess.id,
      'status:',
      existingProcess.status,
    );

    let restartRequired = false;
    const desiredPrimaryModel = getDesiredPrimaryModel(env);
    const desiredGatewayToken = env.MOLTBOT_GATEWAY_TOKEN || null;
    try {
      const effectiveConfig = await readEffectiveGatewayConfig(sandbox);
      if (!effectiveConfig) {
        console.log('Could not read effective gateway config from openclaw.json');
      } else {
        const { primaryModel: effectivePrimaryModel, gatewayToken: effectiveGatewayToken } =
          effectiveConfig;

        if (desiredPrimaryModel && effectivePrimaryModel !== desiredPrimaryModel) {
          console.log(
            'Gateway model drift detected, restarting process:',
            existingProcess.id,
            'effective model:',
            effectivePrimaryModel,
            'desired model:',
            desiredPrimaryModel,
          );
          await existingProcess.kill();
          restartRequired = true;
        } else if (desiredPrimaryModel) {
          console.log('Gateway primary model matches desired env:', desiredPrimaryModel);
        }

        if (!restartRequired && effectiveGatewayToken !== desiredGatewayToken) {
          console.log(
            'Gateway token drift detected, restarting process:',
            existingProcess.id,
            'effective token configured:',
            effectiveGatewayToken !== null,
            'desired token configured:',
            desiredGatewayToken !== null,
          );
          await existingProcess.kill();
          restartRequired = true;
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
      // Always use full startup timeout - a process can be "running" but not ready yet
      // (e.g., just started by another concurrent request). Using a shorter timeout
      // causes race conditions where we kill processes that are still initializing.
      try {
        console.log('Waiting for gateway on port', MOLTBOT_PORT, 'timeout:', STARTUP_TIMEOUT_MS);
        await existingProcess.waitForPort(MOLTBOT_PORT, { mode: 'tcp', timeout: STARTUP_TIMEOUT_MS });
        console.log('Gateway is reachable');
        return existingProcess;
        // eslint-disable-next-line no-unused-vars
      } catch (_e) {
        // Timeout waiting for port - process is likely dead or stuck, kill and restart
        console.log('Existing process not reachable after full timeout, killing and restarting...');
        try {
          await existingProcess.kill();
        } catch (killError) {
          console.log('Failed to kill process:', killError);
        }
      }
    }
  }

  // Start a new OpenClaw gateway
  console.log('Starting new OpenClaw gateway...');
  const envVars = buildEnvVars(env);
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
    console.log('[Gateway] Waiting for OpenClaw gateway to be ready on port', MOLTBOT_PORT);
    await process.waitForPort(MOLTBOT_PORT, { mode: 'tcp', timeout: STARTUP_TIMEOUT_MS });
    console.log('[Gateway] OpenClaw gateway is ready!');

    const logs = await process.getLogs();
    if (logs.stdout) console.log('[Gateway] stdout:', logs.stdout);
    if (logs.stderr) console.log('[Gateway] stderr:', logs.stderr);
  } catch (e) {
    console.error('[Gateway] waitForPort failed:', e);
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
