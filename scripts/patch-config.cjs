#!/usr/bin/env node
/**
 * Patch OpenClaw config with runtime settings.
 *
 * Reads openclaw.json → patches gateway, channels, models → writes back.
 * Extracted from start-openclaw.sh for maintainability and testability.
 */
const fs = require("fs");
const { applyLarkIntegration } = require("./patch-lark-integration.cjs");

const CONFIG_PATH = process.env.CONFIG_PATH || "/root/.openclaw/openclaw.json";

function main() {
  console.log("Patching config at:", CONFIG_PATH);
  let config = {};

  try {
    config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch (e) {
    console.log("Starting with empty config");
  }

  config.gateway = config.gateway || {};
  config.channels = config.channels || {};

  patchGateway(config);
  patchProviders(config);
  patchAIGatewayModel(config);
  patchChannels(config);
  applyLarkIntegration(config);

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
  config.agents.defaults.sandbox = { mode: "off" };

  config.tools = config.tools || {};
  config.tools.exec = config.tools.exec || {};
  config.tools.exec.ask = "on-miss";

  config.commands = config.commands || {};
  config.commands.native = true;

  // Clean up unsupported keys from agents
  patchAgentSecurity(config);

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  console.log("Configuration patched successfully");
}

// ============================================================
// GATEWAY
// ============================================================

function patchGateway(config) {
  config.gateway.port = 18789;
  config.gateway.mode = "local";
  config.gateway.bind = "lan";
  config.gateway.trustedProxies = ["10.1.0.0"];

  config.gateway.controlUi = config.gateway.controlUi || {};
  config.gateway.controlUi.allowedOrigins = [
    "https://moltbot-sandbox.yasuhiko-kohata.workers.dev",
    "https://*.workers.dev",
  ];

  if (process.env.OPENCLAW_GATEWAY_TOKEN) {
    config.gateway.auth = config.gateway.auth || {};
    config.gateway.auth.token = process.env.OPENCLAW_GATEWAY_TOKEN;
  }

  if (process.env.OPENCLAW_DEV_MODE === "true") {
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
      api: "anthropic-messages",
      baseUrl: process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com",
      apiKey: process.env.ANTHROPIC_API_KEY,
    };
  }

  if (process.env.OPENAI_API_KEY) {
    const existing = config.models.providers.openai || {};
    config.models.providers.openai = {
      ...existing,
      api: "openai-completions",
      baseUrl: "https://api.openai.com/v1",
      apiKey: process.env.OPENAI_API_KEY,
      models: existing.models || [
        { id: "*", name: "Any Model", contextWindow: 128000 },
      ],
    };
  }

  if (process.env.OPENROUTER_API_KEY) {
    const existing = config.models.providers.openrouter || {};
    config.models.providers.openrouter = {
      ...existing,
      api: "openai-completions",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: process.env.OPENROUTER_API_KEY,
      models: existing.models || [
        { id: "*", name: "Any Model", contextWindow: 128000 },
      ],
    };
  }

  if (process.env.XAI_API_KEY) {
    const existing = config.models.providers.grok || {};
    config.models.providers.grok = {
      ...existing,
      api: "openai-completions",
      baseUrl: "https://api.x.ai/v1",
      apiKey: process.env.XAI_API_KEY,
      models: existing.models || [
        { id: "*", name: "Any Model", contextWindow: 128000 },
      ],
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
  //   grok/grok-4-1-fast-non-reasoning
  if (!process.env.CF_AI_GATEWAY_MODEL) return;

  const raw = process.env.CF_AI_GATEWAY_MODEL;
  const slashIdx = raw.indexOf("/");
  if (slashIdx <= 0) {
    console.warn("CF_AI_GATEWAY_MODEL must be in provider/model-id format");
    return;
  }
  const gwProvider = raw.substring(0, slashIdx);
  const modelId = raw.substring(slashIdx + 1);

  const accountId = process.env.CF_AI_GATEWAY_ACCOUNT_ID;
  const gatewayId = process.env.CF_AI_GATEWAY_GATEWAY_ID;
  const cfGatewayApiKey = process.env.CLOUDFLARE_AI_GATEWAY_API_KEY;
  const geminiApiKey = process.env.GEMINI_API_KEY;
  const defaultApiKey = cfGatewayApiKey;
  const googleUsesByok = gwProvider === "google-ai-studio" && !geminiApiKey && !!cfGatewayApiKey;
  
  let apiKey;
  if (gwProvider === "grok") {
    apiKey = process.env.XAI_API_KEY || defaultApiKey;
  } else if (gwProvider === "google-ai-studio") {
    // Google AI Studio supports two secure modes through Cloudflare AI Gateway:
    // 1. BYOK at Cloudflare: send the AI Gateway token as the SDK apiKey.
    // 2. Request-header auth: send the Gemini key as apiKey and the AI Gateway
    //    token in cf-aig-authorization when gateway auth is enabled.
    apiKey = googleUsesByok ? cfGatewayApiKey : geminiApiKey;
  } else if (gwProvider === "anthropic") {
    apiKey = process.env.ANTHROPIC_API_KEY || defaultApiKey;
  } else if (gwProvider === "openai") {
    apiKey = process.env.OPENAI_API_KEY || defaultApiKey;
  } else if (gwProvider === "openrouter") {
    apiKey = process.env.OPENROUTER_API_KEY || defaultApiKey;
  } else {
    apiKey = defaultApiKey;
  }

  let baseUrl;
  let api;
  const gatewayModelId = modelId;
  let providerName = "cf-ai-gw-" + gwProvider;
  
  let providerHeaders = undefined;
  if (gwProvider === "google-ai-studio" && cfGatewayApiKey && !googleUsesByok) {
    providerHeaders = { "cf-aig-authorization": "Bearer " + cfGatewayApiKey };
  }

  if (accountId && gatewayId) {
    if (gwProvider === "google-ai-studio") {
      baseUrl = `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}/google-ai-studio/v1beta`;
      api = "google-generative-ai";
      providerName = "google";
      if (!apiKey) {
        console.warn(
          "google-ai-studio model selected without GEMINI_API_KEY or CLOUDFLARE_AI_GATEWAY_API_KEY; requests will fail authentication",
        );
      } else if (googleUsesByok) {
        console.log("AI Gateway auth mode: google-ai-studio via Cloudflare BYOK");
      } else {
        console.log("AI Gateway auth mode: google-ai-studio via request headers");
      }
    } else if (gwProvider === "grok") {
      baseUrl = `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}/grok`;
      api = "openai-completions";
    } else {
      baseUrl = `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}/${gwProvider}`;
      if (gwProvider === "workers-ai") baseUrl += "/v1";
      api =
        gwProvider === "anthropic"
          ? "anthropic-messages"
          : "openai-completions";
    }
  } else if (gwProvider === "workers-ai" && process.env.CF_ACCOUNT_ID) {
    baseUrl = `https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}/ai/v1`;
    api = "openai-completions";
  }

  if (!baseUrl || !apiKey || !api) {
    console.warn(
      "CF_AI_GATEWAY_MODEL set but missing required config (account ID, gateway ID, or API key)",
    );
    return;
  }

  config.models = config.models || {};
  config.models.providers = config.models.providers || {};

  if (gwProvider === "google-ai-studio") {
    delete config.models.providers["cf-ai-gw-google-ai-studio"];
    if (config.auth && config.auth.profiles) {
      delete config.auth.profiles["cloudflare-ai-gateway:default"];
    }
  }

  const providerConfig = {
    baseUrl,
    apiKey,
    api,
    models: [
      {
        id: gatewayModelId,
        name: modelId,
        contextWindow: 131072,
        maxTokens: 8192,
      },
    ],
  };
  if (providerHeaders) providerConfig.headers = providerHeaders;

  config.models.providers[providerName] = providerConfig;
  config.agents = config.agents || {};
  config.agents.defaults = config.agents.defaults || {};
  config.agents.defaults.model = config.agents.defaults.model || {};
  config.agents.defaults.model.primary = providerName + "/" + gatewayModelId;
  console.log(
    `AI Gateway model override: provider=${providerName} model=${gatewayModelId} via ${baseUrl}`,
  );
}

// ============================================================
// CHANNELS
// ============================================================

function patchChannels(config) {
  // Telegram
  if (process.env.TELEGRAM_BOT_TOKEN) {
    const dmPolicy = process.env.TELEGRAM_DM_POLICY || "pairing";
    config.channels.telegram = {
      botToken: process.env.TELEGRAM_BOT_TOKEN,
      enabled: true,
      dmPolicy,
    };
    if (process.env.TELEGRAM_DM_ALLOW_FROM) {
      config.channels.telegram.allowFrom =
        process.env.TELEGRAM_DM_ALLOW_FROM.split(",");
    } else if (dmPolicy === "open") {
      config.channels.telegram.allowFrom = ["*"];
    }
  }

  // Discord — dmPolicy=open requires allowFrom: ["*"]
  //         — groupPolicy=open allows responding in all guild channels
  if (process.env.DISCORD_BOT_TOKEN) {
    const dmPolicy = process.env.DISCORD_DM_POLICY || "pairing";
    const existingDiscord =
      config.channels.discord && typeof config.channels.discord === "object"
        ? sanitizeDiscordChannelConfig(config.channels.discord)
        : {};
    const existingGuilds =
      existingDiscord.guilds && typeof existingDiscord.guilds === "object"
        ? existingDiscord.guilds
        : {};
    config.channels.discord = {
      ...existingDiscord,
      token: process.env.DISCORD_BOT_TOKEN,
      enabled: true,
      dmPolicy,
      groupPolicy: "open",
      // Workaround for OpenClaw issue #4944: DiscordExecApprovalHandler
      // creates GatewayClient without passing the gateway token, causing
      // 2009 Unauthorized on every exec-approval event. commands.native=true
      // already auto-approves all exec commands, so this handler is not needed.
      execApprovals: false,
    };
    if (process.env.DISCORD_DM_ALLOW_FROM) {
      config.channels.discord.allowFrom =
        process.env.DISCORD_DM_ALLOW_FROM.split(",").map((s) => s.trim());
    } else if (dmPolicy === "open") {
      config.channels.discord.allowFrom = ["*"];
    }

    // Configure specific guilds from DISCORD_GUILD_IDS (comma-separated)
    // guilds must be a record: { "guildId": { channels: { "*": {} } } }
    // The "*" wildcard allows the bot to respond in all channels of the guild
    if (process.env.DISCORD_GUILD_IDS) {
      const guildIds = process.env.DISCORD_GUILD_IDS.split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (guildIds.length > 0) {
        config.channels.discord.guilds = {};
        for (const id of guildIds) {
          const existingGuildConfig =
            existingGuilds[id] && typeof existingGuilds[id] === "object"
              ? existingGuilds[id]
              : {};
          const existingChannels =
            existingGuildConfig.channels &&
            typeof existingGuildConfig.channels === "object"
              ? existingGuildConfig.channels
              : {};
          config.channels.discord.guilds[id] = {
            ...existingGuildConfig,
            channels: {
              ...existingChannels,
              "*": existingChannels["*"] || {},
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

function sanitizeDiscordChannelConfig(discordConfig) {
  if (!discordConfig || typeof discordConfig !== "object") {
    return {};
  }

  const next = { ...discordConfig };

  // OpenClaw 2026.4.x rejects this legacy key. Old runtime/R2 state may still
  // carry it, so strip it before patching the effective config.
  if ("presence" in next) {
    delete next.presence;
    console.log("Removed legacy channels.discord.presence key");
  }

  return next;
}

// ============================================================
// LEGACY CONFIG NORMALIZATION
// ============================================================

function normalizeBindings(config) {
  if (!Array.isArray(config.bindings)) {
    return;
  }

  for (const binding of config.bindings) {
    const match = binding && typeof binding === "object" ? binding.match : null;
    if (!match || typeof match !== "object") {
      continue;
    }

    // OpenClaw route bindings no longer accept match.channelId directly.
    // Convert legacy Discord channel targeting into the current peer matcher.
    if (typeof match.channelId === "string" && match.channelId.trim()) {
      if (!match.peer || typeof match.peer !== "object") {
        match.peer = {
          kind: "channel",
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
    if (agent.sandbox) {
      delete agent.sandbox;
    }
    if (agent.shell) {
      delete agent.shell;
      console.log(`Cleaned unsupported 'shell' key from agent: ${agent.id}`);
    }
    if (agent.network) {
      delete agent.network;
      console.log(`Cleaned unsupported 'network' key from agent: ${agent.id}`);
    }

    // CF_AI_GATEWAY_MODEL sets agents.defaults.model.primary (the fallback).
    // Per-agent model settings in openclaw.source.json are intentionally
    // preserved here — OpenClaw's defaults inheritance means the per-agent
    // model overrides the default when explicitly set.
  }
  console.log(
    "Security: agents cleaned, sandbox.mode=off (CF Container is sandbox)",
  );
}

main();
