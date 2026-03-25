#!/usr/bin/env node
/**
 * Persist Discord mention policy changes as runtime overrides.
 *
 * This script updates /root/.openclaw/openclaw.overrides.json, rebuilds the
 * effective openclaw.json from source + overrides, syncs the changed files to
 * R2 immediately when available, and schedules a gateway restart so the new
 * config takes effect.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const { buildConfig, maybeLoadJsonFile } = require('./build-openclaw-config.cjs');

const CONFIG_DIR = process.env.OPENCLAW_CONFIG_DIR || '/root/.openclaw';
const SOURCE_PATH = process.env.OPENCLAW_SOURCE_PATH || path.join(CONFIG_DIR, 'openclaw.source.json');
const OVERRIDES_PATH = process.env.OPENCLAW_OVERRIDES_PATH || path.join(CONFIG_DIR, 'openclaw.overrides.json');
const OUTPUT_PATH = process.env.OPENCLAW_OUTPUT_PATH || path.join(CONFIG_DIR, 'openclaw.json');
const BUNDLED_SOURCE_PATH = process.env.OPENCLAW_BUNDLED_SOURCE_PATH || '/usr/local/lib/openclaw/openclaw.source.json';
const R2_BUCKET = process.env.R2_BUCKET_NAME || 'openclaw-data';

function usage(message) {
  if (message) {
    console.error(message);
  }
  console.error('Usage: node set-discord-mention-mode.cjs --guild <guildId> [--channel <channelId>] --require-mention <true|false> [--no-restart]');
  process.exit(1);
}

function parseArgs(argv) {
  const args = {
    restart: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--guild') {
      args.guildId = argv[++i];
    } else if (arg === '--channel') {
      args.channelId = argv[++i];
    } else if (arg === '--require-mention') {
      const value = argv[++i];
      if (value !== 'true' && value !== 'false') {
        usage('Expected --require-mention true|false');
      }
      args.requireMention = value === 'true';
    } else if (arg === '--no-restart') {
      args.restart = false;
    } else {
      usage(`Unknown argument: ${arg}`);
    }
  }

  if (!args.guildId) usage('--guild is required');
  if (typeof args.requireMention !== 'boolean') usage('--require-mention is required');

  return args;
}

function assertDiscordId(value, label) {
  if (!/^\d+$/.test(value)) {
    usage(`${label} must be a Discord snowflake`);
  }
}

function ensureSourceFile() {
  if (fs.existsSync(SOURCE_PATH)) {
    return;
  }

  fs.mkdirSync(CONFIG_DIR, { recursive: true });

  if (fs.existsSync(BUNDLED_SOURCE_PATH)) {
    fs.copyFileSync(BUNDLED_SOURCE_PATH, SOURCE_PATH);
    return;
  }

  if (fs.existsSync(OUTPUT_PATH)) {
    fs.copyFileSync(OUTPUT_PATH, SOURCE_PATH);
    return;
  }

  throw new Error(`No source config available at ${SOURCE_PATH}`);
}

function updateOverrides({ guildId, channelId, requireMention }) {
  const overrides = maybeLoadJsonFile(OVERRIDES_PATH);

  overrides.channels = overrides.channels || {};
  overrides.channels.discord = overrides.channels.discord || {};
  overrides.channels.discord.guilds = overrides.channels.discord.guilds || {};

  const guildConfig = overrides.channels.discord.guilds[guildId] || {};
  guildConfig.channels = guildConfig.channels || {};

  if (channelId) {
    const channelConfig = guildConfig.channels[channelId] || {};
    guildConfig.channels[channelId] = {
      ...channelConfig,
      requireMention,
    };
  } else {
    guildConfig.requireMention = requireMention;
  }

  overrides.channels.discord.guilds[guildId] = guildConfig;
  fs.writeFileSync(OVERRIDES_PATH, `${JSON.stringify(overrides, null, 2)}\n`);
}

function syncConfigArtifacts() {
  if (!process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY || !process.env.CF_ACCOUNT_ID) {
    return;
  }

  const files = [
    ['openclaw.source.json', SOURCE_PATH],
    ['openclaw.overrides.json', OVERRIDES_PATH],
    ['openclaw.json', OUTPUT_PATH],
  ];

  for (const [remoteName, localPath] of files) {
    if (!fs.existsSync(localPath)) {
      continue;
    }

    execFileSync(
      'rclone',
      ['copyto', localPath, `r2:${R2_BUCKET}/openclaw/${remoteName}`],
      { stdio: 'ignore' },
    );
  }
}

function scheduleRestart() {
  spawnSync(
    'sh',
    ['-lc', '(sleep 2; pkill -f "openclaw gateway" || true) >/dev/null 2>&1 &'],
    { stdio: 'ignore' },
  );
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  run(args);
}

function run(args) {
  assertDiscordId(args.guildId, 'guildId');
  if (args.channelId) {
    assertDiscordId(args.channelId, 'channelId');
  }

  ensureSourceFile();
  updateOverrides(args);
  buildConfig({
    sourcePath: SOURCE_PATH,
    overridesPath: OVERRIDES_PATH,
    outputPath: OUTPUT_PATH,
  });
  syncConfigArtifacts();

  if (args.restart) {
    scheduleRestart();
  }

  const scope = args.channelId
    ? `guild=${args.guildId} channel=${args.channelId}`
    : `guild=${args.guildId}`;

  console.log(
    `Updated Discord mention policy: ${scope} requireMention=${args.requireMention} restartScheduled=${args.restart}`,
  );
}

if (require.main === module) {
  main();
}

module.exports = {
  parseArgs,
  run,
  updateOverrides,
  ensureSourceFile,
};
