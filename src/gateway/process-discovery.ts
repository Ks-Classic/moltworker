import type { Process, Sandbox } from '@cloudflare/sandbox';

/**
 * Find an existing OpenClaw gateway process.
 */
export async function findExistingGatewayProcess(sandbox: Sandbox): Promise<Process | null> {
  try {
    const processes = await sandbox.listProcesses();
    for (const proc of processes) {
      const isGatewayProcess =
        proc.command.includes('start-openclaw.sh') ||
        proc.command.includes('openclaw gateway') ||
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
  } catch (error) {
    console.log('Could not list processes:', error);
  }

  return null;
}

// Backward-compatible alias while the rest of the codebase migrates away from
// legacy Moltbot naming.
export const findExistingMoltbotProcess = findExistingGatewayProcess;
