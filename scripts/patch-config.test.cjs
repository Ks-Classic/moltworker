#!/usr/bin/env node
/**
 * Tests for patch-config.js
 *
 * Validates that the config patching logic produces valid OpenClaw configuration.
 * Created after the 2026-03-20 incident where unsupported agent-level keys
 * (shell, network) caused a 16-hour gateway outage.
 */
const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

const PATCH_SCRIPT = path.join(__dirname, 'patch-config.cjs');
const TMP_CONFIG = '/tmp/patch-config-test.json';

// Keys that OpenClaw 2026.3.13 recognizes at the agent level
const KNOWN_AGENT_KEYS = [
  'id', 'name', 'default', 'workspace', 'compaction',
  'maxConcurrent', 'subagents', 'sandbox', 'model',
];

// Minimal valid base config for testing
const BASE_CONFIG = {
  agents: {
    defaults: {
      workspace: '/root/clawd',
      compaction: { mode: 'safeguard' },
      maxConcurrent: 4,
      subagents: { maxConcurrent: 8 },
      sandbox: { mode: 'off' },
    },
    list: [
      { id: 'main', default: true, subagents: { allowAgents: ['*'] } },
      { id: 'e-spiral', name: 'E-SPIRAL', sandbox: { mode: 'all' } },
      { id: 'e-spiral-dev', name: 'E-SPIRAL Dev', workspace: '/root/clawd/projects/e-spiral', sandbox: { mode: 'off' } },
    ],
  },
  bindings: [],
  messages: { ackReactionScope: 'group-mentions' },
  commands: { native: true, nativeSkills: 'auto', restart: true, ownerDisplay: 'raw' },
  plugins: { entries: { discord: { enabled: true } } },
};

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ❌ ${name}`);
    console.error(`     ${e.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function runPatchConfig(config, env = {}) {
  fs.writeFileSync(TMP_CONFIG, JSON.stringify(config, null, 2));

  const envVars = {
    CONFIG_PATH: TMP_CONFIG,
    DISCORD_BOT_TOKEN: 'test-token',
    DISCORD_DM_POLICY: 'pairing',
    DISCORD_DM_ALLOW_FROM: '1076754229294796834',
    DISCORD_GUILD_IDS: '1075560600878448680,1455869574355619934',
    CLOUDFLARE_AI_GATEWAY_API_KEY: 'test-key',
    CF_AI_GATEWAY_ACCOUNT_ID: 'test-account',
    CF_AI_GATEWAY_GATEWAY_ID: 'test-gateway',
    CF_AI_GATEWAY_MODEL: 'google-ai-studio/gemini-3.1-flash-lite-preview',
    OPENCLAW_GATEWAY_TOKEN: 'test-gw-token',
    ...env,
  };

  const envStr = Object.entries(envVars)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(' ');

  execSync(`${envStr} node ${PATCH_SCRIPT}`, { stdio: 'pipe' });

  return JSON.parse(fs.readFileSync(TMP_CONFIG, 'utf8'));
}

// ===================================================================
console.log('\n🧪 patch-config.js tests\n');

// -------------------------------------------------------------------
console.log('Agent key validation:');

test('patched config has no unknown agent keys', () => {
  const result = runPatchConfig(JSON.parse(JSON.stringify(BASE_CONFIG)));

  for (const agent of result.agents.list) {
    for (const key of Object.keys(agent)) {
      assert(
        KNOWN_AGENT_KEYS.includes(key),
        `Agent "${agent.id}" has unknown key "${key}" — OpenClaw will reject this`
      );
    }
  }
});

test('e-spiral agent should NOT have shell key', () => {
  const result = runPatchConfig(JSON.parse(JSON.stringify(BASE_CONFIG)));
  const espiral = result.agents.list.find(a => a.id === 'e-spiral');
  assert(!espiral.shell, 'e-spiral should not have "shell" key');
});

test('e-spiral agent should NOT have network key', () => {
  const result = runPatchConfig(JSON.parse(JSON.stringify(BASE_CONFIG)));
  const espiral = result.agents.list.find(a => a.id === 'e-spiral');
  assert(!espiral.network, 'e-spiral should not have "network" key');
});

test('cleans up pre-existing shell/network keys from agents', () => {
  const dirty = JSON.parse(JSON.stringify(BASE_CONFIG));
  dirty.agents.list[1].shell = { allowlist: [] };
  dirty.agents.list[1].network = { allowlist: [] };
  dirty.agents.list[2].shell = { allowlist: ['git'] };
  dirty.agents.list[2].network = { allowlist: ['github.com'] };

  const result = runPatchConfig(dirty);

  for (const agent of result.agents.list) {
    assert(!agent.shell, `Agent "${agent.id}" still has "shell" key after patching`);
    assert(!agent.network, `Agent "${agent.id}" still has "network" key after patching`);
  }
});

test('e-spiral agent should NOT have sandbox key (managed at defaults level)', () => {
  const result = runPatchConfig(JSON.parse(JSON.stringify(BASE_CONFIG)));
  const espiral = result.agents.list.find(a => a.id === 'e-spiral');
  assert(!espiral.sandbox, 'e-spiral should not have per-agent sandbox (use defaults)');
});

test('agents.defaults.sandbox.mode is "off"', () => {
  const result = runPatchConfig(JSON.parse(JSON.stringify(BASE_CONFIG)));
  assert(result.agents?.defaults?.sandbox?.mode === 'off', `Expected defaults.sandbox.mode="off", got "${result.agents?.defaults?.sandbox?.mode}"`);
});

test('tools.exec.ask is "on-miss"', () => {
  const result = runPatchConfig(JSON.parse(JSON.stringify(BASE_CONFIG)));
  assert(result.tools?.exec?.ask === 'on-miss', `Expected tools.exec.ask="on-miss", got "${result.tools?.exec?.ask}"`);
});

// -------------------------------------------------------------------
console.log('\nDiscord channel config:');

test('Discord channels are configured with guild IDs', () => {
  const result = runPatchConfig(JSON.parse(JSON.stringify(BASE_CONFIG)));
  assert(result.channels?.discord?.guilds, 'Discord guilds should be configured');
  assert(result.channels.discord.guilds['1075560600878448680'], 'Guild 1 should exist');
  assert(result.channels.discord.guilds['1455869574355619934'], 'Guild 2 should exist');
});

test('Discord groupPolicy is "open"', () => {
  const result = runPatchConfig(JSON.parse(JSON.stringify(BASE_CONFIG)));
  assert(result.channels?.discord?.groupPolicy === 'open', 'groupPolicy should be "open"');
});

test('Discord allowFrom is set from DISCORD_DM_ALLOW_FROM', () => {
  const result = runPatchConfig(JSON.parse(JSON.stringify(BASE_CONFIG)));
  assert(
    result.channels?.discord?.allowFrom?.includes('1076754229294796834'),
    'allowFrom should contain the owner ID'
  );
});

test('Legacy binding match.channelId is converted to match.peer.kind=channel', () => {
  const dirty = JSON.parse(JSON.stringify(BASE_CONFIG));
  dirty.bindings = [
    {
      agentId: 'e-spiral-dev',
      match: {
        channel: 'discord',
        guildId: '1075560600878448680',
        channelId: '1483087564973015105',
      },
    },
  ];

  const result = runPatchConfig(dirty);
  const match = result.bindings?.[0]?.match;
  assert(!('channelId' in match), 'Legacy match.channelId should be removed');
  assert(match?.peer?.kind === 'channel', `Expected peer.kind="channel", got ${match?.peer?.kind}`);
  assert(match?.peer?.id === '1483087564973015105', `Expected peer.id to preserve channelId, got ${match?.peer?.id}`);
  assert(match?.guildId === '1075560600878448680', 'Existing guildId should be preserved');
});

test('Existing guild requireMention setting is preserved when env guilds are applied', () => {
  const dirty = JSON.parse(JSON.stringify(BASE_CONFIG));
  dirty.channels = {
    discord: {
      guilds: {
        '1455869574355619934': {
          channels: { '*': {} },
          requireMention: false,
        },
      },
    },
  };

  const result = runPatchConfig(dirty);
  assert(
    result.channels?.discord?.guilds?.['1455869574355619934']?.requireMention === false,
    'Guild-specific requireMention should be preserved'
  );
});

test('Legacy discord presence key is removed from runtime config', () => {
  const dirty = JSON.parse(JSON.stringify(BASE_CONFIG));
  dirty.channels = {
    discord: {
      presence: {
        status: 'online',
      },
      guilds: {
        '1455869574355619934': {
          channels: { '*': {} },
        },
      },
    },
  };

  const result = runPatchConfig(dirty);
  assert(!('presence' in result.channels.discord), 'Legacy discord presence key should be removed');
});



// -------------------------------------------------------------------
console.log('\nGateway config:');

test('Gateway port is 18789', () => {
  const result = runPatchConfig(JSON.parse(JSON.stringify(BASE_CONFIG)));
  assert(result.gateway?.port === 18789, `Expected port 18789, got ${result.gateway?.port}`);
});

test('Gateway bind is "lan"', () => {
  const result = runPatchConfig(JSON.parse(JSON.stringify(BASE_CONFIG)));
  assert(result.gateway?.bind === 'lan', `Expected bind "lan", got ${result.gateway?.bind}`);
});

test('Gateway token is set from env', () => {
  const result = runPatchConfig(JSON.parse(JSON.stringify(BASE_CONFIG)));
  assert(result.gateway?.auth?.token === 'test-gw-token', 'Gateway token should be set');
});

// -------------------------------------------------------------------
console.log('\nAI model config:');

test('AI model provider is configured', () => {
  const result = runPatchConfig(JSON.parse(JSON.stringify(BASE_CONFIG)));
  assert(result.models?.providers?.google, 'Google AI provider should be configured');
});

test('Default model is set correctly', () => {
  const result = runPatchConfig(JSON.parse(JSON.stringify(BASE_CONFIG)));
  const primary = result.agents?.defaults?.model?.primary;
  assert(primary === 'google/gemini-3.1-flash-lite-preview', `Expected google/gemini-3.1-flash-lite-preview, got ${primary}`);
});

// -------------------------------------------------------------------
console.log('\nLark integration boundary:');

test('patch-config remains stable when Lark env is absent', () => {
  const result = runPatchConfig(JSON.parse(JSON.stringify(BASE_CONFIG)), {
    LARK_APP_ID: '',
    LARK_APP_SECRET: '',
    LARK_BASE_TOKEN: '',
    LARK_TABLE_ID: '',
  });
  assert(result.plugins?.entries?.discord?.enabled === true, 'Discord plugin should remain enabled');
});

test('Grok provider-native AI Gateway uses the grok endpoint and xAI key', () => {
  const result = runPatchConfig(JSON.parse(JSON.stringify(BASE_CONFIG)), {
    CF_AI_GATEWAY_MODEL: 'grok/grok-4-1-fast-non-reasoning',
    XAI_API_KEY: 'xai-test-key',
  });

  const provider = result.models?.providers?.['cf-ai-gw-grok'];
  assert(provider, 'Grok AI Gateway provider should be configured');
  assert(
    provider.baseUrl === 'https://gateway.ai.cloudflare.com/v1/test-account/test-gateway/grok',
    `Expected grok provider-native URL, got ${provider?.baseUrl}`
  );
  assert(provider.apiKey === 'xai-test-key', 'Expected xAI API key to be used for grok');
  assert(!provider.headers, 'Grok provider-native should not inject cf-aig-authorization headers');
  assert(
    result.agents?.defaults?.model?.primary === 'cf-ai-gw-grok/grok-4-1-fast-non-reasoning',
    `Expected grok default model, got ${result.agents?.defaults?.model?.primary}`
  );
});



// -------------------------------------------------------------------
// Summary
console.log(`\n${'─'.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);

// Cleanup
try { fs.unlinkSync(TMP_CONFIG); } catch {}

if (failed > 0) {
  process.exit(1);
}
