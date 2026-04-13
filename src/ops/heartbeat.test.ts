import { describe, expect, it } from 'vitest';
import { buildDailyHeartbeatCommand, shouldRunDailyHeartbeat } from './heartbeat';
import { createMockEnv } from '../test-utils';

describe('shouldRunDailyHeartbeat', () => {
  it('matches only the configured daily heartbeat cron', () => {
    expect(shouldRunDailyHeartbeat('0 23 * * *')).toBe(true);
    expect(shouldRunDailyHeartbeat('*/5 * * * *')).toBe(false);
  });
});

describe('buildDailyHeartbeatCommand', () => {
  it('builds a command with defaults when no overrides are provided', () => {
    const spec = buildDailyHeartbeatCommand(createMockEnv());

    expect(spec.recipientId).toBe('1076754229294796834');
    expect(spec.prompt).toContain('HEARTBEAT.md');
    expect(spec.command).toContain('--reply-channel discord');
    expect(spec.command).toContain('--reply-to "1076754229294796834"');
    expect(spec.command).toContain('--url "ws://localhost:18789"');
  });

  it('uses explicit heartbeat overrides and preserves shell-safe quoting', () => {
    const spec = buildDailyHeartbeatCommand(
      createMockEnv({
        HEARTBEAT_RECIPIENT_ID: 'user-123',
        HEARTBEAT_PROMPT: 'say "hello" and report $status',
        MOLTBOT_GATEWAY_TOKEN: 'secret-token',
      }),
    );

    expect(spec.recipientId).toBe('user-123');
    expect(spec.prompt).toBe('say "hello" and report $status');
    expect(spec.command).toContain('--reply-to "user-123"');
    expect(spec.command).toContain('--message "say \\"hello\\" and report \\$status"');
    expect(spec.command).toContain('--url "ws://localhost:18789?token=secret-token"');
  });
});
