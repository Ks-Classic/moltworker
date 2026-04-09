import type { MoltbotEnv } from '../types';

/**
 * Build environment variables to pass to the OpenClaw container process
 *
 * @param env - Worker environment bindings
 * @returns Environment variables record
 */
export function buildEnvVars(env: MoltbotEnv): Record<string, string> {
  const envVars: Record<string, string> = {};

  // Cloudflare AI Gateway configuration (new native provider)
  if (env.CLOUDFLARE_AI_GATEWAY_API_KEY) {
    envVars.CLOUDFLARE_AI_GATEWAY_API_KEY = env.CLOUDFLARE_AI_GATEWAY_API_KEY;
  }
  if (env.CF_AI_GATEWAY_ACCOUNT_ID) {
    envVars.CF_AI_GATEWAY_ACCOUNT_ID = env.CF_AI_GATEWAY_ACCOUNT_ID;
  }
  if (env.CF_AI_GATEWAY_GATEWAY_ID) {
    envVars.CF_AI_GATEWAY_GATEWAY_ID = env.CF_AI_GATEWAY_GATEWAY_ID;
  }

  // Direct provider keys
  if (env.ANTHROPIC_API_KEY) envVars.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;
  if (env.OPENAI_API_KEY) envVars.OPENAI_API_KEY = env.OPENAI_API_KEY;
  if (env.OPENROUTER_API_KEY) envVars.OPENROUTER_API_KEY = env.OPENROUTER_API_KEY;

  // Legacy AI Gateway support: AI_GATEWAY_BASE_URL + AI_GATEWAY_API_KEY
  // When set, these override direct keys for backward compatibility
  if (env.AI_GATEWAY_API_KEY && env.AI_GATEWAY_BASE_URL) {
    const normalizedBaseUrl = env.AI_GATEWAY_BASE_URL.replace(/\/+$/, '');
    envVars.AI_GATEWAY_BASE_URL = normalizedBaseUrl;
    // Legacy path routes through Anthropic base URL
    envVars.ANTHROPIC_BASE_URL = normalizedBaseUrl;
    envVars.ANTHROPIC_API_KEY = env.AI_GATEWAY_API_KEY;
  } else if (env.ANTHROPIC_BASE_URL) {
    envVars.ANTHROPIC_BASE_URL = env.ANTHROPIC_BASE_URL;
  }

  // Map MOLTBOT_GATEWAY_TOKEN to OPENCLAW_GATEWAY_TOKEN (container expects this name)
  if (env.MOLTBOT_GATEWAY_TOKEN) envVars.OPENCLAW_GATEWAY_TOKEN = env.MOLTBOT_GATEWAY_TOKEN;
  if (env.DEV_MODE) envVars.OPENCLAW_DEV_MODE = env.DEV_MODE;
  if (env.TELEGRAM_BOT_TOKEN) envVars.TELEGRAM_BOT_TOKEN = env.TELEGRAM_BOT_TOKEN;
  if (env.TELEGRAM_DM_POLICY) envVars.TELEGRAM_DM_POLICY = env.TELEGRAM_DM_POLICY;
  if (env.DISCORD_BOT_TOKEN) envVars.DISCORD_BOT_TOKEN = env.DISCORD_BOT_TOKEN;
  if (env.DISCORD_DM_POLICY) envVars.DISCORD_DM_POLICY = env.DISCORD_DM_POLICY;
  if (env.DISCORD_GUILD_IDS) envVars.DISCORD_GUILD_IDS = env.DISCORD_GUILD_IDS;
  if (env.SLACK_BOT_TOKEN) envVars.SLACK_BOT_TOKEN = env.SLACK_BOT_TOKEN;
  if (env.SLACK_APP_TOKEN) envVars.SLACK_APP_TOKEN = env.SLACK_APP_TOKEN;
  if (env.CF_AI_GATEWAY_MODEL) envVars.CF_AI_GATEWAY_MODEL = env.CF_AI_GATEWAY_MODEL;
  if (env.CF_ACCOUNT_ID) envVars.CF_ACCOUNT_ID = env.CF_ACCOUNT_ID;
  if (env.CDP_SECRET) envVars.CDP_SECRET = env.CDP_SECRET;
  if (env.WORKER_URL) envVars.WORKER_URL = env.WORKER_URL;

  // R2 persistence credentials (used by rclone in start-openclaw.sh)
  if (env.R2_ACCESS_KEY_ID) envVars.R2_ACCESS_KEY_ID = env.R2_ACCESS_KEY_ID;
  if (env.R2_SECRET_ACCESS_KEY) envVars.R2_SECRET_ACCESS_KEY = env.R2_SECRET_ACCESS_KEY;
  if (env.R2_BUCKET_NAME) envVars.R2_BUCKET_NAME = env.R2_BUCKET_NAME;

  // Google Workspace (gog CLI) credentials
  if (env.GOG_KEYRING_PASSWORD) envVars.GOG_KEYRING_PASSWORD = env.GOG_KEYRING_PASSWORD;
  if (env.GOG_ACCOUNT) envVars.GOG_ACCOUNT = env.GOG_ACCOUNT;

  // Lark (Feishu) API credentials
  if (env.LARK_APP_ID) envVars.LARK_APP_ID = env.LARK_APP_ID;
  if (env.LARK_APP_SECRET) envVars.LARK_APP_SECRET = env.LARK_APP_SECRET;
  if (env.LARK_BASE_TOKEN) envVars.LARK_BASE_TOKEN = env.LARK_BASE_TOKEN;
  if (env.LARK_TABLE_ID) envVars.LARK_TABLE_ID = env.LARK_TABLE_ID;

  // Jira MCP configuration
  if (env.JIRA_MCP_URL) envVars.JIRA_MCP_URL = env.JIRA_MCP_URL;
  if (env.JIRA_MCP_TRANSPORT) envVars.JIRA_MCP_TRANSPORT = env.JIRA_MCP_TRANSPORT;
  if (env.JIRA_MCP_AUTH_TOKEN) envVars.JIRA_MCP_AUTH_TOKEN = env.JIRA_MCP_AUTH_TOKEN;
  if (env.JIRA_MCP_HEADERS_JSON) envVars.JIRA_MCP_HEADERS_JSON = env.JIRA_MCP_HEADERS_JSON;
  if (env.JIRA_MCP_CONNECTION_TIMEOUT_MS) envVars.JIRA_MCP_CONNECTION_TIMEOUT_MS = env.JIRA_MCP_CONNECTION_TIMEOUT_MS;
  if (env.JIRA_MCP_COMMAND) envVars.JIRA_MCP_COMMAND = env.JIRA_MCP_COMMAND;
  if (env.JIRA_MCP_ARGS_JSON) envVars.JIRA_MCP_ARGS_JSON = env.JIRA_MCP_ARGS_JSON;
  if (env.JIRA_MCP_ENV_JSON) envVars.JIRA_MCP_ENV_JSON = env.JIRA_MCP_ENV_JSON;
  if (env.JIRA_MCP_CWD) envVars.JIRA_MCP_CWD = env.JIRA_MCP_CWD;
  if (env.JIRA_BASE_URL) envVars.JIRA_BASE_URL = env.JIRA_BASE_URL;
  if (env.JIRA_EMAIL) envVars.JIRA_EMAIL = env.JIRA_EMAIL;
  if (env.JIRA_API_TOKEN) envVars.JIRA_API_TOKEN = env.JIRA_API_TOKEN;

  return envVars;
}
