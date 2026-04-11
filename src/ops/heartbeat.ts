import type { MoltbotEnv } from '../types';

export const DAILY_HEARTBEAT_CRON = '0 23 * * *';
export const DEFAULT_HEARTBEAT_RECIPIENT = '1076754229294796834';
export const DEFAULT_HEARTBEAT_PROMPT =
  'HEARTBEAT.mdの指示通りにセキュリティチェックとデイリーブリーフィング（gog calendarの情報のみ）を実行し、その結果を報告してください。';

export interface HeartbeatCommandSpec {
  prompt: string;
  recipientId: string;
  command: string;
}

function escapeCliDoubleQuotes(value: string): string {
  return value.replace(/(["\\$`])/g, '\\$1');
}

export function shouldRunDailyHeartbeat(cron: string): boolean {
  return cron === DAILY_HEARTBEAT_CRON;
}

export function buildDailyHeartbeatCommand(env: MoltbotEnv): HeartbeatCommandSpec {
  const recipientId =
    env.HEARTBEAT_RECIPIENT_ID || env.DISCORD_DM_ALLOW_FROM || DEFAULT_HEARTBEAT_RECIPIENT;
  const prompt = env.HEARTBEAT_PROMPT || DEFAULT_HEARTBEAT_PROMPT;
  const tokenArg = env.MOLTBOT_GATEWAY_TOKEN ? `?token=${env.MOLTBOT_GATEWAY_TOKEN}` : '';
  const escapedPrompt = escapeCliDoubleQuotes(prompt);

  return {
    prompt,
    recipientId,
    command: `openclaw agent --agent main --message "${escapedPrompt}" --deliver --reply-channel discord --reply-to "${recipientId}" --url "ws://localhost:18789${tokenArg}"`,
  };
}
