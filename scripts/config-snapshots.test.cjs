#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = path.join(__dirname, 'config-snapshots.cjs');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed += 1;
  } catch (error) {
    console.error(`  ❌ ${name}`);
    console.error(`     ${error.message}`);
    failed += 1;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function loadModule(fixture) {
  process.env.OPENCLAW_CONFIG_DIR = fixture.dir;
  process.env.OPENCLAW_SOURCE_PATH = fixture.sourcePath;
  process.env.OPENCLAW_OVERRIDES_PATH = fixture.overridesPath;
  process.env.OPENCLAW_OUTPUT_PATH = fixture.outputPath;
  process.env.OPENCLAW_SNAPSHOTS_DIR = fixture.snapshotsDir;
  process.env.OPENCLAW_MAX_CONFIG_SNAPSHOTS = '10';

  delete require.cache[require.resolve(SCRIPT)];
  return require(SCRIPT);
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function makeFixtureDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-snapshots-test-'));
  const sourcePath = path.join(dir, 'openclaw.source.json');
  const overridesPath = path.join(dir, 'openclaw.overrides.json');
  const outputPath = path.join(dir, 'openclaw.json');
  const snapshotsDir = path.join(dir, 'snapshots');

  writeJson(sourcePath, {
    channels: {
      discord: {
        guilds: {
          '1': {
            requireMention: true,
          },
        },
      },
    },
  });

  writeJson(overridesPath, {
    channels: {
      discord: {
        guilds: {
          '1': {
            requireMention: false,
          },
        },
      },
    },
  });

  writeJson(outputPath, {
    channels: {
      discord: {
        guilds: {
          '1': {
            requireMention: false,
          },
        },
      },
    },
  });

  return {
    dir,
    sourcePath,
    overridesPath,
    outputPath,
    snapshotsDir,
  };
}

console.log('\n🧪 config-snapshots.cjs tests\n');

test('saveSnapshot stores tracked files and metadata', () => {
  const fixture = makeFixtureDir();
  const { saveSnapshot } = loadModule(fixture);
  const snapshot = saveSnapshot({
    reason: 'mention-mode',
    now: new Date('2026-03-25T07:15:00Z'),
  });

  const snapshotDir = path.join(fixture.snapshotsDir, snapshot.id);
  assert(fs.existsSync(path.join(snapshotDir, 'openclaw.source.json')), 'Expected source snapshot');
  assert(fs.existsSync(path.join(snapshotDir, 'openclaw.overrides.json')), 'Expected overrides snapshot');
  assert(fs.existsSync(path.join(snapshotDir, 'openclaw.json')), 'Expected generated snapshot');

  const metadata = JSON.parse(fs.readFileSync(path.join(snapshotDir, 'metadata.json'), 'utf8'));
  assert(metadata.reason === 'mention-mode', 'Expected sanitized reason in metadata');
});

test('saveSnapshot keeps only the latest 10 generations', () => {
  const fixture = makeFixtureDir();
  const { saveSnapshot, listSnapshots } = loadModule(fixture);

  for (let i = 0; i < 12; i += 1) {
    saveSnapshot({
      reason: `run-${i}`,
      now: new Date(Date.UTC(2026, 2, 25, 7, 15, i)),
    });
  }

  const snapshots = listSnapshots();
  assert(snapshots.length === 10, `Expected 10 snapshots, got ${snapshots.length}`);
  assert(
    !snapshots.some((snapshot) => snapshot.reason === 'run-0'),
    'Expected oldest snapshot to be pruned',
  );
  assert(
    snapshots[0].reason === 'run-11',
    `Expected newest snapshot first, got ${snapshots[0].reason}`,
  );
});

test('restoreSnapshot reverts source, generated, and removes missing overrides', () => {
  const fixture = makeFixtureDir();
  const { saveSnapshot, restoreSnapshot } = loadModule(fixture);

  fs.rmSync(fixture.overridesPath, { force: true });
  writeJson(fixture.outputPath, {
    channels: {
      discord: {
        guilds: {
          '1': {
            requireMention: true,
          },
        },
      },
    },
  });

  const snapshot = saveSnapshot({
    reason: 'baseline',
    now: new Date('2026-03-25T07:16:00Z'),
  });

  writeJson(fixture.sourcePath, {
    channels: {
      discord: {
        guilds: {
          '1': {
            requireMention: false,
          },
        },
      },
    },
  });
  writeJson(fixture.overridesPath, {
    channels: {
      discord: {
        guilds: {
          '1': {
            channels: {
              '2': {
                requireMention: false,
              },
            },
          },
        },
      },
    },
  });
  writeJson(fixture.outputPath, {
    channels: {
      discord: {
        guilds: {
          '1': {
            requireMention: false,
            channels: {
              '2': {
                requireMention: false,
              },
            },
          },
        },
      },
    },
  });

  const result = restoreSnapshot({
    snapshotId: snapshot.id,
    restart: false,
  });

  const restoredSource = JSON.parse(fs.readFileSync(fixture.sourcePath, 'utf8'));
  const restoredOutput = JSON.parse(fs.readFileSync(fixture.outputPath, 'utf8'));

  assert(result.restoredSnapshot.id === snapshot.id, 'Expected restored snapshot id');
  assert(!fs.existsSync(fixture.overridesPath), 'Expected overrides file to be removed');
  assert(
    restoredSource.channels.discord.guilds['1'].requireMention === true,
    'Expected source to be restored',
  );
  assert(
    restoredOutput.channels.discord.guilds['1'].requireMention === true,
    'Expected generated config rebuilt from restored source',
  );
});

console.log(`\n${'─'.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exit(1);
}
