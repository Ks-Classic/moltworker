import type { Process, Sandbox } from '@cloudflare/sandbox';
import { findExistingMoltbotProcess } from '../gateway';

export interface ConfigFileSnapshot {
  path: string;
  exists: boolean;
  mtimeEpochSeconds?: number;
  json?: unknown;
}

export interface ConfigDiffSummary {
  source: ConfigFileSnapshot;
  overrides: ConfigFileSnapshot;
  generated: ConfigFileSnapshot;
  changedPathsFromSource: string[];
  overridePaths: string[];
  process: {
    id?: string;
    status: 'running' | 'not_running';
    startTimeEpochSeconds?: number;
    generatedUpdatedAfterStart: boolean;
  };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function collectChangedPaths(base: unknown, next: unknown, prefix = ''): string[] {
  if (JSON.stringify(base) === JSON.stringify(next)) {
    return [];
  }

  const isBaseObject = !!base && typeof base === 'object' && !Array.isArray(base);
  const isNextObject = !!next && typeof next === 'object' && !Array.isArray(next);

  if (!isBaseObject || !isNextObject) {
    return [prefix || '$'];
  }

  const keys = new Set([
    ...Object.keys(base as Record<string, unknown>),
    ...Object.keys(next as Record<string, unknown>),
  ]);

  const paths: string[] = [];
  for (const key of keys) {
    const childPrefix = prefix ? `${prefix}.${key}` : key;
    paths.push(
      ...collectChangedPaths(
        (base as Record<string, unknown>)[key],
        (next as Record<string, unknown>)[key],
        childPrefix,
      ),
    );
  }

  return paths;
}

export function collectLeafPaths(value: unknown, prefix = ''): string[] {
  const isObject = !!value && typeof value === 'object' && !Array.isArray(value);
  if (!isObject) {
    return [prefix || '$'];
  }

  const keys = Object.keys(value as Record<string, unknown>);
  if (keys.length === 0) {
    return [prefix || '$'];
  }

  return keys.flatMap((key) =>
    collectLeafPaths(
      (value as Record<string, unknown>)[key],
      prefix ? `${prefix}.${key}` : key,
    ),
  );
}

async function readJsonSnapshot(sandbox: Sandbox, filePath: string): Promise<ConfigFileSnapshot> {
  const quoted = shellQuote(filePath);
  const result = await sandbox.exec(
    `if [ -f ${quoted} ]; then stat -c '%Y' ${quoted}; printf '\\n__JSON__\\n'; cat ${quoted}; else printf '__MISSING__'; fi`,
    { timeout: 10000 },
  );

  const stdout = result.stdout || '';
  if (!result.success || stdout.trim() === '__MISSING__') {
    return {
      path: filePath,
      exists: false,
    };
  }

  const [mtimeRaw, jsonRaw = ''] = stdout.split('\n__JSON__\n');
  return {
    path: filePath,
    exists: true,
    mtimeEpochSeconds: Number(mtimeRaw.trim()),
    json: JSON.parse(jsonRaw),
  };
}

function summarizeProcess(process: Process | null, generated: ConfigFileSnapshot) {
  if (!process) {
    return {
      status: 'not_running' as const,
      generatedUpdatedAfterStart: false,
    };
  }

  const startTimeEpochSeconds = process.startTime
    ? Math.floor(process.startTime.getTime() / 1000)
    : undefined;
  const generatedUpdatedAfterStart =
    !!generated.mtimeEpochSeconds &&
    !!startTimeEpochSeconds &&
    generated.mtimeEpochSeconds > startTimeEpochSeconds;

  return {
    id: process.id,
    status: 'running' as const,
    startTimeEpochSeconds,
    generatedUpdatedAfterStart,
  };
}

export async function buildConfigDiffSummary(sandbox: Sandbox): Promise<ConfigDiffSummary> {
  const [source, overrides, generated, process] = await Promise.all([
    readJsonSnapshot(sandbox, '/root/.openclaw/openclaw.source.json'),
    readJsonSnapshot(sandbox, '/root/.openclaw/openclaw.overrides.json'),
    readJsonSnapshot(sandbox, '/root/.openclaw/openclaw.json'),
    findExistingMoltbotProcess(sandbox),
  ]);

  return {
    source,
    overrides,
    generated,
    changedPathsFromSource:
      source.exists && generated.exists
        ? collectChangedPaths(source.json, generated.json)
        : [],
    overridePaths: overrides.exists ? collectLeafPaths(overrides.json) : [],
    process: summarizeProcess(process, generated),
  };
}
