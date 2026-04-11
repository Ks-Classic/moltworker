#!/usr/bin/env node
const fs = require('fs');

const STATE_PATH = process.env.RUNTIME_STATE_FILE || '/tmp/openclaw-runtime-state.json';

function coerceValue(raw) {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;
  if (raw === 'now') return new Date().toISOString();
  if (/^-?\d+$/.test(raw)) return Number(raw);
  return raw;
}

function main() {
  const patch = {};

  for (const arg of process.argv.slice(2)) {
    const idx = arg.indexOf('=');
    if (idx <= 0) continue;
    const key = arg.slice(0, idx);
    const value = arg.slice(idx + 1);
    patch[key] = coerceValue(value);
  }

  let current = {};
  try {
    current = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {}

  const next = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(STATE_PATH, JSON.stringify(next, null, 2));
  process.stdout.write(JSON.stringify(next));
}

main();
