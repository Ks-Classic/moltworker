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
  patchProviders(config);
  patchAIGatewayModel(config);
  patchChannels(config);
  patchJiraMcp(config);
  normalizeBindings(config);

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
// PROVIDERS DIRECT CONFIG
// ============================================================

function patchProviders(config) {
  config.models = config.models || {};
  config.models.providers = config.models.providers || {};

  if (process.env.ANTHROPIC_API_KEY) {
    const existing = config.models.providers.anthropic || {};
    config.models.providers.anthropic = {
      ...existing,
      api: 'anthropic-messages',
      baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
      apiKey: process.env.ANTHROPIC_API_KEY
    };
  }

  if (process.env.OPENAI_API_KEY) {
    const existing = config.models.providers.openai || {};
    config.models.providers.openai = {
      ...existing,
      api: 'openai-completions',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: process.env.OPENAI_API_KEY,
      models: existing.models || [{ id: "*", name: "Any Model", contextWindow: 128000 }]
    };
  }

  if (process.env.OPENROUTER_API_KEY) {
    const existing = config.models.providers.openrouter || {};
    config.models.providers.openrouter = {
      ...existing,
      api: 'openai-completions',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: process.env.OPENROUTER_API_KEY,
      models: existing.models || [{ id: "*", name: "Any Model", contextWindow: 128000 }]
    };
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
  config.agents.defaults.model = config.agents.defaults.model || {};
  config.agents.defaults.model.primary = providerName + '/' + gatewayModelId;
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
    const existingDiscord = config.channels.discord && typeof config.channels.discord === 'object'
      ? config.channels.discord
      : {};
    const existingGuilds = existingDiscord.guilds && typeof existingDiscord.guilds === 'object'
      ? existingDiscord.guilds
      : {};
    config.channels.discord = {
      ...existingDiscord,
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
          const existingGuildConfig = existingGuilds[id] && typeof existingGuilds[id] === 'object'
            ? existingGuilds[id]
            : {};
          const existingChannels = existingGuildConfig.channels && typeof existingGuildConfig.channels === 'object'
            ? existingGuildConfig.channels
            : {};
          config.channels.discord.guilds[id] = {
            ...existingGuildConfig,
            channels: {
              ...existingChannels,
              '*': existingChannels['*'] || {},
            },
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
// MCP
// ============================================================

function patchJiraMcp(config) {
  const remoteUrl = readTrimmedEnv('JIRA_MCP_URL');
  const command = readTrimmedEnv('JIRA_MCP_COMMAND');

  if (!remoteUrl && !command) {
    return;
  }

  config.mcp = config.mcp || {};
  config.mcp.servers = config.mcp.servers || {};

  if (remoteUrl) {
    const headers = parseJsonEnv('JIRA_MCP_HEADERS_JSON', 'object');
    const authToken = readTrimmedEnv('JIRA_MCP_AUTH_TOKEN');
    const transport = readTrimmedEnv('JIRA_MCP_TRANSPORT');
    const connectionTimeoutMs = parseIntegerEnv('JIRA_MCP_CONNECTION_TIMEOUT_MS');
    const serverConfig = {
      url: remoteUrl,
    };

    if (headers) {
      serverConfig.headers = headers;
    }
    if (authToken) {
      serverConfig.headers = {
        ...serverConfig.headers,
        Authorization: `Bearer ${authToken}`,
      };
    }
    if (transport === 'streamable-http') {
      serverConfig.transport = 'streamable-http';
    } else if (transport && transport !== 'sse') {
      console.warn(`Ignoring unsupported JIRA_MCP_TRANSPORT=${transport}`);
    }
    if (connectionTimeoutMs !== undefined) {
      serverConfig.connectionTimeoutMs = connectionTimeoutMs;
    }

    config.mcp.servers.jira = serverConfig;
    console.log('Configured Jira MCP server via remote transport');
    return;
  }

  const args = parseJsonEnv('JIRA_MCP_ARGS_JSON', 'array') || [];
  const extraEnv = parseJsonEnv('JIRA_MCP_ENV_JSON', 'object') || {};
  const cwd = readTrimmedEnv('JIRA_MCP_CWD');
  const serverEnv = {
    ...collectJiraRuntimeEnv(),
    ...extraEnv,
  };
  const serverConfig = {
    command,
  };

  if (args.length > 0) {
    serverConfig.args = args;
  }
  if (Object.keys(serverEnv).length > 0) {
    serverConfig.env = serverEnv;
  }
  if (cwd) {
    serverConfig.cwd = cwd;
  }

  config.mcp.servers.jira = serverConfig;
  console.log('Configured Jira MCP server via stdio transport');
}

function collectJiraRuntimeEnv() {
  const runtimeEnv = {};
  const passThroughKeys = [
    'JIRA_BASE_URL',
    'JIRA_EMAIL',
    'JIRA_API_TOKEN',
  ];

  for (const key of passThroughKeys) {
    const value = readTrimmedEnv(key);
    if (value) {
      runtimeEnv[key] = value;
    }
  }

  return runtimeEnv;
}

function parseJsonEnv(name, expectedType) {
  const raw = readTrimmedEnv(name);
  if (!raw) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw);
    if (expectedType === 'array' && Array.isArray(parsed)) {
      return parsed;
    }
    if (expectedType === 'object' && parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
    console.warn(`Ignoring ${name}: expected ${expectedType} JSON`);
  } catch (error) {
    console.warn(`Ignoring ${name}: invalid JSON (${error.message})`);
  }

  return undefined;
}

function parseIntegerEnv(name) {
  const raw = readTrimmedEnv(name);
  if (!raw) {
    return undefined;
  }

  const parsed = Number.parseInt(raw, 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }

  console.warn(`Ignoring ${name}: expected positive integer`);
  return undefined;
}

function readTrimmedEnv(name) {
  const value = process.env[name];
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

// ============================================================
// LEGACY CONFIG NORMALIZATION
// ============================================================

function normalizeBindings(config) {
  if (!Array.isArray(config.bindings)) {
    return;
  }

  for (const binding of config.bindings) {
    const match = binding && typeof binding === 'object' ? binding.match : null;
    if (!match || typeof match !== 'object') {
      continue;
    }

    // OpenClaw route bindings no longer accept match.channelId directly.
    // Convert legacy Discord channel targeting into the current peer matcher.
    if (typeof match.channelId === 'string' && match.channelId.trim()) {
      if (!match.peer || typeof match.peer !== 'object') {
        match.peer = {
          kind: 'channel',
          id: match.channelId.trim(),
        };
      }
      delete match.channelId;
    }
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
    
    // If system-wide AI Gateway model is set, override per-agent models too
    if (process.env.CF_AI_GATEWAY_MODEL && agent.model) {
      delete agent.model;
      console.log(`Overriding per-agent model for: ${agent.id}`);
    }
  }
  console.log('Security: agents cleaned, sandbox.mode=off (CF Container is sandbox)');
}

main();
