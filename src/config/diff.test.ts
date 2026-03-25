import { describe, expect, it, vi } from 'vitest';
import type { Process, Sandbox } from '@cloudflare/sandbox';
import {
  buildConfigDiffSummary,
  collectChangedPaths,
  collectLeafPaths,
} from './diff';

describe('collectChangedPaths', () => {
  it('returns only changed nested paths', () => {
    const result = collectChangedPaths(
      {
        channels: {
          discord: {
            guilds: {
              '1': { requireMention: true },
            },
          },
        },
      },
      {
        channels: {
          discord: {
            guilds: {
              '1': { requireMention: false },
            },
          },
        },
      },
    );

    expect(result).toEqual(['channels.discord.guilds.1.requireMention']);
  });

  it('marks array replacement at the nearest path', () => {
    const result = collectChangedPaths(
      { bindings: [{ id: 'koh' }] },
      { bindings: [{ id: 'koh' }, { id: 'e-spiral' }] },
    );

    expect(result).toEqual(['bindings']);
  });
});

describe('collectLeafPaths', () => {
  it('returns all leaf paths for nested overrides', () => {
    const result = collectLeafPaths({
      channels: {
        discord: {
          guilds: {
            '1': {
              requireMention: false,
              channels: {
                '2': {
                  requireMention: true,
                },
              },
            },
          },
        },
      },
    });

    expect(result).toEqual([
      'channels.discord.guilds.1.requireMention',
      'channels.discord.guilds.1.channels.2.requireMention',
    ]);
  });
});

describe('buildConfigDiffSummary', () => {
  it('summarizes source, overrides, generated config, and process state', async () => {
    const source = {
      channels: {
        discord: {
          guilds: {
            '1': { requireMention: true },
          },
        },
      },
    };
    const overrides = {
      channels: {
        discord: {
          guilds: {
            '1': {
              requireMention: false,
            },
          },
        },
      },
    };
    const generated = {
      channels: {
        discord: {
          guilds: {
            '1': { requireMention: false },
          },
        },
      },
    };

    const exec = vi
      .fn()
      .mockResolvedValueOnce({
        success: true,
        stdout: `100\n__JSON__\n${JSON.stringify(source)}`,
      })
      .mockResolvedValueOnce({
        success: true,
        stdout: `110\n__JSON__\n${JSON.stringify(overrides)}`,
      })
      .mockResolvedValueOnce({
        success: true,
        stdout: `120\n__JSON__\n${JSON.stringify(generated)}`,
      });

    const process = {
      id: 'proc-1',
      command: 'openclaw gateway',
      status: 'running',
      startTime: new Date(90 * 1000),
    } as Process;

    const sandbox = {
      exec,
      listProcesses: vi.fn().mockResolvedValue([process]),
    } as unknown as Sandbox;

    const summary = await buildConfigDiffSummary(sandbox);

    expect(summary.source.exists).toBe(true);
    expect(summary.overrides.exists).toBe(true);
    expect(summary.generated.exists).toBe(true);
    expect(summary.changedPathsFromSource).toEqual(['channels.discord.guilds.1.requireMention']);
    expect(summary.overridePaths).toEqual(['channels.discord.guilds.1.requireMention']);
    expect(summary.process).toEqual({
      id: 'proc-1',
      status: 'running',
      startTimeEpochSeconds: 90,
      generatedUpdatedAfterStart: true,
    });
  });

  it('handles missing files and no running process', async () => {
    const sandbox = {
      exec: vi.fn().mockResolvedValue({
        success: false,
        stdout: '__MISSING__',
      }),
      listProcesses: vi.fn().mockResolvedValue([]),
    } as unknown as Sandbox;

    const summary = await buildConfigDiffSummary(sandbox);

    expect(summary.source.exists).toBe(false);
    expect(summary.overrides.exists).toBe(false);
    expect(summary.generated.exists).toBe(false);
    expect(summary.changedPathsFromSource).toEqual([]);
    expect(summary.overridePaths).toEqual([]);
    expect(summary.process).toEqual({
      status: 'not_running',
      generatedUpdatedAfterStart: false,
    });
  });
});
