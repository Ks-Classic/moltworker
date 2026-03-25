#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const SCRIPT = path.join(__dirname, 'set-discord-mention-mode.cjs');

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

function makeFixtureDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mention-mode-test-'));
  const sourcePath = path.join(dir, 'openclaw.source.json');
  const overridesPath = path.join(dir, 'openclaw.overrides.json');
  const outputPath = path.join(dir, 'openclaw.json');

  const source = {
    channels: {
      discord: {
        guilds: {
          '1455869574355619934': {
            requireMention: true,
            channels: {
              '*': {},
            },
          },
        },
      },
    },
  };

  fs.writeFileSync(sourcePath, `${JSON.stringify(source, null, 2)}\n`);

  return {
    dir,
    sourcePath,
    overridesPath,
    outputPath,
  };
}

function runScript(fixture, args) {
  process.env.OPENCLAW_CONFIG_DIR = fixture.dir;
  process.env.OPENCLAW_SOURCE_PATH = fixture.sourcePath;
  process.env.OPENCLAW_OVERRIDES_PATH = fixture.overridesPath;
  process.env.OPENCLAW_OUTPUT_PATH = fixture.outputPath;

  delete require.cache[require.resolve(SCRIPT)];
  const { parseArgs, run } = require(SCRIPT);
  run(parseArgs(args));
}

console.log('\n🧪 set-discord-mention-mode.cjs tests\n');

test('updates guild-level requireMention override', () => {
  const fixture = makeFixtureDir();
  runScript(fixture, ['--guild', '1455869574355619934', '--require-mention', 'false', '--no-restart']);

  const overrides = JSON.parse(fs.readFileSync(fixture.overridesPath, 'utf8'));
  const output = JSON.parse(fs.readFileSync(fixture.outputPath, 'utf8'));

  assert(
    overrides.channels.discord.guilds['1455869574355619934'].requireMention === false,
    'Expected guild override requireMention=false',
  );
  assert(
    output.channels.discord.guilds['1455869574355619934'].requireMention === false,
    'Expected built config requireMention=false',
  );
});

test('updates channel-level requireMention override without removing wildcard', () => {
  const fixture = makeFixtureDir();
  runScript(
    fixture,
    [
      '--guild',
      '1455869574355619934',
      '--channel',
      '1460894988861706314',
      '--require-mention',
      'false',
      '--no-restart',
    ],
  );

  const overrides = JSON.parse(fs.readFileSync(fixture.overridesPath, 'utf8'));
  const output = JSON.parse(fs.readFileSync(fixture.outputPath, 'utf8'));
  const guild = output.channels.discord.guilds['1455869574355619934'];

  assert(
    overrides.channels.discord.guilds['1455869574355619934'].channels['1460894988861706314'].requireMention === false,
    'Expected channel override requireMention=false',
  );
  assert(guild.channels['*'], 'Expected wildcard channel to remain in built config');
  assert(
    guild.channels['1460894988861706314'].requireMention === false,
    'Expected channel-level requireMention=false in built config',
  );
});

console.log(`\n${'─'.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exit(1);
}
