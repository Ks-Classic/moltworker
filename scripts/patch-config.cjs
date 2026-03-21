#!/usr/bin/env node
/**
 * Patch OpenClaw config with runtime settings.
 *
 * Reads openclaw.json → patches gateway, channels, models → writes back.
 * Extracted from start-openclaw.sh for maintainability and testability.
 */
const fs = require('fs');

const CONFIG_PATH = process.env.CONFIG_PATH || '/root/.openclaw/openclaw.json';

function main() {
  console.log('Patching config at:', CONFIG_PATH);
  let config = {};

  try {
    config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (e) {
    console.log('Starting with empty config');
  }

  config.gateway = config.gateway || {};
  config.channels = config.channels || {};

  patchGateway(config);
  patchAIGatewayModel(config);
  patchChannels(config);

  // ── Security Model ──────────────────────────────────────────
  // Layer 1 (HARD): Cloudflare Container IS the sandbox (no host access)
  // Layer 2 (HARD): sandbox.mode = "off" — Docker not available in CF Containers
  //                  Sandbox isolation provided by CF Container itself
  // Layer 3 (HARD): tools.exec.ask = "on-miss" — unknown commands require
  //                  approval via Web UI or terminal UI
  // Layer 4 (HARD): commands.native = true — Discord has no approval UI
  // Layer 5 (SOFT): AGENTS.md instructs AI to only allow system
  //                  operations from owner Discord ID
  config.agents = config.agents || {};
  config.agents.defaults = config.agents.defaults || {};
  config.agents.defaults.sandbox = { mode: 'off' };

  config.tools = config.tools || {};
  config.tools.exec = config.tools.exec || {};
  config.tools.exec.ask = 'on-miss';

  config.commands = config.commands || {};
  config.commands.native = true;

  // Clean up unsupported keys from agents
  patchAgentSecurity(config);

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  console.log('Configuration patched successfully');
}

// ============================================================
// GATEWAY
// ============================================================

function patchGateway(config) {
  config.gateway.port = 18789;
  config.gateway.mode = 'local';
  config.gateway.bind = 'lan';
  config.gateway.trustedProxies = ['10.1.0.0'];

  config.gateway.controlUi = config.gateway.controlUi || {};
  config.gateway.controlUi.allowedOrigins = [
    'https://moltbot-sandbox.yasuhiko-kohata.workers.dev',
    'https://*.workers.dev',
  ];

  if (process.env.OPENCLAW_GATEWAY_TOKEN) {
    config.gateway.auth = config.gateway.auth || {};
    config.gateway.auth.token = process.env.OPENCLAW_GATEWAY_TOKEN;
  }

  if (process.env.OPENCLAW_DEV_MODE === 'true') {
    config.gateway.controlUi.allowInsecureAuth = true;
  }
}

// ============================================================
// AI GATEWAY MODEL OVERRIDE
// ============================================================

function patchAIGatewayModel(config) {
  // CF_AI_GATEWAY_MODEL=provider/model-id
  // Examples:
  //   google-ai-studio/gemini-3.1-flash-lite-preview
  //   workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast
  //   openai/gpt-4o
  //   anthropic/claude-sonnet-4-5
  if (!process.env.CF_AI_GATEWAY_MODEL) return;

  const raw = process.env.CF_AI_GATEWAY_MODEL;
  const slashIdx = raw.indexOf('/');
  const gwProvider = raw.substring(0, slashIdx);
  const modelId = raw.substring(slashIdx + 1);

  const accountId = process.env.CF_AI_GATEWAY_ACCOUNT_ID;
  const gatewayId = process.env.CF_AI_GATEWAY_GATEWAY_ID;
  const apiKey = process.env.CLOUDFLARE_AI_GATEWAY_API_KEY;

  let baseUrl;
  let api;
  const gatewayModelId = modelId;
  let providerName = 'cf-ai-gw-' + gwProvider;
  let providerHeaders = { 'cf-aig-authorization': 'Bearer ' + apiKey };

  if (accountId && gatewayId) {
    if (gwProvider === 'google-ai-studio') {
      baseUrl = `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}/google-ai-studio/v1beta`;
      api = 'google-generative-ai';
      providerName = 'google';
      providerHeaders = undefined;
    } else {
      baseUrl = `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}/${gwProvider}`;
      if (gwProvider === 'workers-ai') baseUrl += '/v1';
      api = gwProvider === 'anthropic' ? 'anthropic-messages' : 'openai-completions';
    }
  } else if (gwProvider === 'workers-ai' && process.env.CF_ACCOUNT_ID) {
    baseUrl = `https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}/ai/v1`;
    api = 'openai-completions';
  }

  if (!baseUrl || !apiKey || !api) {
    console.warn('CF_AI_GATEWAY_MODEL set but missing required config (account ID, gateway ID, or API key)');
    return;
  }

  config.models = config.models || {};
  config.models.providers = config.models.providers || {};

  if (gwProvider === 'google-ai-studio') {
    delete config.models.providers['cf-ai-gw-google-ai-studio'];
    if (config.auth && config.auth.profiles) {
      delete config.auth.profiles['cloudflare-ai-gateway:default'];
    }
  }

  const providerConfig = {
    baseUrl,
    apiKey,
    api,
    models: [{ id: gatewayModelId, name: modelId, contextWindow: 131072, maxTokens: 8192 }],
  };
  if (providerHeaders) providerConfig.headers = providerHeaders;

  config.models.providers[providerName] = providerConfig;
  config.agents = config.agents || {};
  config.agents.defaults = config.agents.defaults || {};
  config.agents.defaults.model = { primary: providerName + '/' + gatewayModelId };
  console.log(`AI Gateway model override: provider=${providerName} model=${gatewayModelId} via ${baseUrl}`);
}

// ============================================================
// CHANNELS
// ============================================================

function patchChannels(config) {
  // Telegram
  if (process.env.TELEGRAM_BOT_TOKEN) {
    const dmPolicy = process.env.TELEGRAM_DM_POLICY || 'pairing';
    config.channels.telegram = {
      botToken: process.env.TELEGRAM_BOT_TOKEN,
      enabled: true,
      dmPolicy,
    };
    if (process.env.TELEGRAM_DM_ALLOW_FROM) {
      config.channels.telegram.allowFrom = process.env.TELEGRAM_DM_ALLOW_FROM.split(',');
    } else if (dmPolicy === 'open') {
      config.channels.telegram.allowFrom = ['*'];
    }
  }

  // Discord — dmPolicy=open requires allowFrom: ["*"]
  //         — groupPolicy=open allows responding in all guild channels
  if (process.env.DISCORD_BOT_TOKEN) {
    const dmPolicy = process.env.DISCORD_DM_POLICY || 'pairing';
    config.channels.discord = {
      token: process.env.DISCORD_BOT_TOKEN,
      enabled: true,
      dmPolicy,
      groupPolicy: 'open',
    };
    if (process.env.DISCORD_DM_ALLOW_FROM) {
      config.channels.discord.allowFrom = process.env.DISCORD_DM_ALLOW_FROM.split(',').map(s => s.trim());
    } else if (dmPolicy === 'open') {
      config.channels.discord.allowFrom = ['*'];
    }

    // Configure specific guilds from DISCORD_GUILD_IDS (comma-separated)
    // guilds must be a record: { "guildId": { channels: { "*": {} } } }
    // The "*" wildcard allows the bot to respond in all channels of the guild
    if (process.env.DISCORD_GUILD_IDS) {
      const guildIds = process.env.DISCORD_GUILD_IDS.split(',').map(s => s.trim()).filter(Boolean);
      if (guildIds.length > 0) {
        config.channels.discord.guilds = {};
        for (const id of guildIds) {
          config.channels.discord.guilds[id] = {
            channels: { '*': {} },
          };
        }
      }
    }

  }

  // Slack
  if (process.env.SLACK_BOT_TOKEN && process.env.SLACK_APP_TOKEN) {
    config.channels.slack = {
      botToken: process.env.SLACK_BOT_TOKEN,
      appToken: process.env.SLACK_APP_TOKEN,
      enabled: true,
    };
  }
}

// ============================================================
// AGENT SECURITY (per-agent hard restrictions)
// ============================================================

function patchAgentSecurity(config) {
  config.agents = config.agents || {};
  config.agents.list = config.agents.list || [];

  // Clean up unsupported keys from all agents
  // (shell/network are NOT supported at agent level in OpenClaw 2026.3.13+)
  for (const agent of config.agents.list) {
    // Remove per-agent sandbox — use defaults.sandbox instead
    if (agent.sandbox) { delete agent.sandbox; }
    if (agent.shell) { delete agent.shell; console.log(`Cleaned unsupported 'shell' key from agent: ${agent.id}`); }
    if (agent.network) { delete agent.network; console.log(`Cleaned unsupported 'network' key from agent: ${agent.id}`); }
  }
  console.log('Security: agents cleaned, sandbox.mode=off (CF Container is sandbox)');
}

main();
