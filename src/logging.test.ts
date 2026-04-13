import { describe, expect, it } from 'vitest';
import { redactSensitiveParams } from './utils/logging';

describe('logging utils', () => {
  it('redacts gateway token query params', () => {
    const url = new URL('https://moltbot.workers.dev/?token=abc123def456');
    const result = decodeURIComponent(redactSensitiveParams(url));
    expect(result).toContain('token=[REDACTED]');
  });

  it('redacts cdp secret query params', () => {
    const url = new URL('https://moltbot.workers.dev/cdp/json/version?secret=my-cdp-secret');
    const result = decodeURIComponent(redactSensitiveParams(url));
    expect(result).toContain('secret=[REDACTED]');
  });
});
