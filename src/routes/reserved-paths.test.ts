import { describe, expect, it } from 'vitest';
import { isReservedWorkerPath } from './reserved-paths';

describe('reserved worker paths', () => {
  it('marks worker-owned namespaces as reserved', () => {
    expect(isReservedWorkerPath('/api/status')).toBe(true);
    expect(isReservedWorkerPath('/_admin/')).toBe(true);
    expect(isReservedWorkerPath('/debug/runtime-state')).toBe(true);
    expect(isReservedWorkerPath('/sandbox-health')).toBe(true);
    expect(isReservedWorkerPath('/cdp/json/version')).toBe(true);
  });

  it('does not mark gateway-owned paths as reserved', () => {
    expect(isReservedWorkerPath('/')).toBe(false);
    expect(isReservedWorkerPath('/chat')).toBe(false);
    expect(isReservedWorkerPath('/assets/index.js')).toBe(false);
  });
});
