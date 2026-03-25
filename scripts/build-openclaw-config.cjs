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
const OVERRIDES_PATH = process.env.OPENCLAW_OVERRIDES_PATH || '';
const OUTPUT_PATH = process.env.OPENCLAW_OUTPUT_PATH || path.join(ROOT, 'openclaw', 'openclaw.json');

function loadJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function maybeLoadJsonFile(filePath) {
  if (!filePath) {
    return {};
  }

  if (!fs.existsSync(filePath)) {
    return {};
  }

  return loadJsonFile(filePath);
}

function deepMerge(base, override) {
  if (Array.isArray(base) || Array.isArray(override)) {
    return override === undefined ? base : override;
  }

  if (
    !base ||
    typeof base !== 'object' ||
    !override ||
    typeof override !== 'object'
  ) {
    return override === undefined ? base : override;
  }

  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    result[key] = key in base ? deepMerge(base[key], value) : value;
  }
  return result;
}

function buildConfig({ sourcePath = SOURCE_PATH, overridesPath = OVERRIDES_PATH, outputPath = OUTPUT_PATH } = {}) {
  const sourceConfig = loadJsonFile(sourcePath);
  const overridesConfig = maybeLoadJsonFile(overridesPath);
  const finalConfig = deepMerge(sourceConfig, overridesConfig);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(finalConfig, null, 2)}\n`);

  return {
    sourcePath,
    overridesPath,
    outputPath,
  };
}

function main() {
  const { sourcePath, overridesPath, outputPath } = buildConfig();
  const sourceLabel = path.relative(ROOT, sourcePath);
  const outputLabel = path.relative(ROOT, outputPath);

  if (overridesPath) {
    const overridesLabel = path.relative(ROOT, overridesPath);
    console.log(`Built ${outputLabel} from ${sourceLabel} with overrides ${overridesLabel}`);
    return;
  }

  console.log(`Built ${outputLabel} from ${sourceLabel}`);
}

if (require.main === module) {
  main();
}

module.exports = {
  buildConfig,
  deepMerge,
  loadJsonFile,
  maybeLoadJsonFile,
};
