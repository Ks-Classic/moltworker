#!/usr/bin/env node
/**
 * Verify that the generated OpenClaw config matches the canonical source.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE_PATH = process.env.OPENCLAW_SOURCE_PATH || path.join(ROOT, 'config', 'openclaw.source.json');
const OUTPUT_PATH = process.env.OPENCLAW_OUTPUT_PATH || path.join(ROOT, 'openclaw', 'openclaw.json');

function normalizeJsonFile(filePath) {
  return JSON.stringify(JSON.parse(fs.readFileSync(filePath, 'utf8')));
}

function main() {
  const source = normalizeJsonFile(SOURCE_PATH);
  const output = normalizeJsonFile(OUTPUT_PATH);

  if (source !== output) {
    console.error('openclaw/openclaw.json is out of date. Run: npm run config:build');
    process.exit(1);
  }

  console.log('OpenClaw config is up to date.');
}

main();
