#!/usr/bin/env node
/**
 * Build the deployable OpenClaw config from the canonical source file.
 *
 * This keeps a single declarative source of truth in-repo and makes
 * openclaw/openclaw.json a generated artifact.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE_PATH = process.env.OPENCLAW_SOURCE_PATH || path.join(ROOT, 'config', 'openclaw.source.json');
const OUTPUT_PATH = process.env.OPENCLAW_OUTPUT_PATH || path.join(ROOT, 'openclaw', 'openclaw.json');

function main() {
  const sourceRaw = fs.readFileSync(SOURCE_PATH, 'utf8');
  const sourceConfig = JSON.parse(sourceRaw);

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(sourceConfig, null, 2)}\n`);

  console.log(`Built ${path.relative(ROOT, OUTPUT_PATH)} from ${path.relative(ROOT, SOURCE_PATH)}`);
}

main();
