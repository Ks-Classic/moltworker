#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const { buildConfig } = require('./build-openclaw-config.cjs');

const CONFIG_DIR = process.env.OPENCLAW_CONFIG_DIR || '/root/.openclaw';
const SOURCE_PATH = process.env.OPENCLAW_SOURCE_PATH || path.join(CONFIG_DIR, 'openclaw.source.json');
const OVERRIDES_PATH = process.env.OPENCLAW_OVERRIDES_PATH || path.join(CONFIG_DIR, 'openclaw.overrides.json');
const OUTPUT_PATH = process.env.OPENCLAW_OUTPUT_PATH || path.join(CONFIG_DIR, 'openclaw.json');
const SNAPSHOTS_DIR = process.env.OPENCLAW_SNAPSHOTS_DIR || path.join(CONFIG_DIR, 'snapshots');
const MAX_SNAPSHOTS = Number(process.env.OPENCLAW_MAX_CONFIG_SNAPSHOTS || '10');
const R2_BUCKET = process.env.R2_BUCKET_NAME || 'openclaw-data';
const TRACKED_FILES = [
  ['openclaw.source.json', SOURCE_PATH],
  ['openclaw.overrides.json', OVERRIDES_PATH],
  ['openclaw.json', OUTPUT_PATH],
];

function usage(message) {
  if (message) {
    console.error(message);
  }
  console.error('Usage: node config-snapshots.cjs [--list-json] [--save --reason <reason>] [--restore [snapshotId]] [--no-restart]');
  process.exit(1);
}

function sanitizeReason(reason) {
  return (reason || 'manual')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'manual';
}

function createSnapshotId(now, reason) {
  const compact = now.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[:]/g, '').replace(/-/g, '');
  return `${compact}-${sanitizeReason(reason)}`;
}

function ensureSnapshotDir() {
  fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function copyTrackedFiles(targetDir) {
  const presentFiles = [];
  for (const [fileName, sourcePath] of TRACKED_FILES) {
    if (!fs.existsSync(sourcePath)) {
      continue;
    }

    fs.copyFileSync(sourcePath, path.join(targetDir, fileName));
    presentFiles.push(fileName);
  }
  return presentFiles;
}

function parseSnapshotMetadata(snapshotId) {
  const metadataPath = path.join(SNAPSHOTS_DIR, snapshotId, 'metadata.json');
  if (fs.existsSync(metadataPath)) {
    return JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  }

  const createdAt = snapshotId.slice(0, 16).replace(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
    '$1-$2-$3T$4:$5:$6Z',
  );
  return {
    id: snapshotId,
    createdAt,
    reason: snapshotId.split('-').slice(1).join('-') || 'manual',
    files: [],
  };
}

function listSnapshots() {
  if (!fs.existsSync(SNAPSHOTS_DIR)) {
    return [];
  }

  return fs
    .readdirSync(SNAPSHOTS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => parseSnapshotMetadata(entry.name))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function pruneSnapshots() {
  const snapshots = listSnapshots();
  for (const snapshot of snapshots.slice(MAX_SNAPSHOTS)) {
    fs.rmSync(path.join(SNAPSHOTS_DIR, snapshot.id), { recursive: true, force: true });
  }
}

function saveSnapshot({ reason = 'manual', now = new Date() } = {}) {
  ensureSnapshotDir();

  const snapshotId = createSnapshotId(now, reason);
  const snapshotDir = path.join(SNAPSHOTS_DIR, snapshotId);
  fs.mkdirSync(snapshotDir, { recursive: true });
  const files = copyTrackedFiles(snapshotDir);
  const metadata = {
    id: snapshotId,
    createdAt: now.toISOString(),
    reason: sanitizeReason(reason),
    files,
  };
  writeJson(path.join(snapshotDir, 'metadata.json'), metadata);
  pruneSnapshots();
  return metadata;
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

function restoreSnapshot({ snapshotId, restart = true }) {
  const snapshots = listSnapshots();
  const target =
    snapshotId
      ? snapshots.find((snapshot) => snapshot.id === snapshotId)
      : snapshots[0];

  if (!target) {
    throw new Error(snapshotId ? `Snapshot not found: ${snapshotId}` : 'No snapshots available');
  }

  const snapshotDir = path.join(SNAPSHOTS_DIR, target.id);
  fs.mkdirSync(CONFIG_DIR, { recursive: true });

  for (const [fileName, destinationPath] of TRACKED_FILES) {
    const sourcePath = path.join(snapshotDir, fileName);
    if (fs.existsSync(sourcePath)) {
      fs.copyFileSync(sourcePath, destinationPath);
    } else {
      fs.rmSync(destinationPath, { force: true });
    }
  }

  if (fs.existsSync(SOURCE_PATH)) {
    buildConfig({
      sourcePath: SOURCE_PATH,
      overridesPath: OVERRIDES_PATH,
      outputPath: OUTPUT_PATH,
    });
  }

  syncConfigArtifacts();

  if (restart) {
    scheduleRestart();
  }

  return {
    restoredSnapshot: target,
    restartScheduled: restart,
  };
}

function parseArgs(argv) {
  const args = {
    restart: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--list-json') {
      args.action = 'list';
    } else if (arg === '--save') {
      args.action = 'save';
    } else if (arg === '--reason') {
      args.reason = argv[++i];
    } else if (arg === '--restore') {
      args.action = 'restore';
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args.snapshotId = next;
        i += 1;
      }
    } else if (arg === '--no-restart') {
      args.restart = false;
    } else {
      usage(`Unknown argument: ${arg}`);
    }
  }

  if (!args.action) {
    usage('Specify one of --list-json, --save, or --restore');
  }

  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.action === 'list') {
    console.log(JSON.stringify({ snapshots: listSnapshots() }));
    return;
  }

  if (args.action === 'save') {
    console.log(JSON.stringify({ snapshot: saveSnapshot({ reason: args.reason }) }));
    return;
  }

  console.log(JSON.stringify(restoreSnapshot(args)));
}

if (require.main === module) {
  main();
}

module.exports = {
  TRACKED_FILES,
  createSnapshotId,
  listSnapshots,
  parseArgs,
  restoreSnapshot,
  sanitizeReason,
  saveSnapshot,
};
