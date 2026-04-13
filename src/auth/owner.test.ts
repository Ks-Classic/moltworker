import { describe, expect, it, vi } from 'vitest';
import type { Context } from 'hono';
import type { AppEnv, MoltbotEnv } from '../types';
import { createMockEnv } from '../test-utils';
import { createOwnerMiddleware, hasOwnerAccess, parseAllowedEmails } from './owner';

function createMockContext(options: {
  env?: Partial<MoltbotEnv>;
  accessUser?: { email: string; name?: string };
}) {
  const jsonMock = vi.fn().mockReturnValue(new Response());
  const htmlMock = vi.fn().mockReturnValue(new Response());

  const c = {
    env: createMockEnv(options.env),
    get: vi.fn((key: string) => (key === 'accessUser' ? options.accessUser : undefined)),
    json: jsonMock,
    html: htmlMock,
  } as unknown as Context<AppEnv>;

  return { c, jsonMock, htmlMock };
}

describe('parseAllowedEmails', () => {
  it('parses and normalizes the owner email allowlist', () => {
    expect(
      parseAllowedEmails(
        createMockEnv({
          ADMIN_ALLOWED_EMAILS: ' Owner@Example.com, second@example.com ,, ',
        }),
      ),
    ).toEqual(['owner@example.com', 'second@example.com']);
  });
});

describe('hasOwnerAccess', () => {
  it('matches owner email case-insensitively', () => {
    expect(
      hasOwnerAccess(
        createMockEnv({ ADMIN_ALLOWED_EMAILS: 'owner@example.com' }),
        'OWNER@example.com',
      ),
    ).toBe(true);
  });

  it('returns false when allowlist is empty', () => {
    expect(hasOwnerAccess(createMockEnv({}), 'owner@example.com')).toBe(false);
  });
});

describe('createOwnerMiddleware', () => {
  it('allows requests from configured owner emails', async () => {
    const { c, jsonMock } = createMockContext({
      env: { ADMIN_ALLOWED_EMAILS: 'owner@example.com' },
      accessUser: { email: 'owner@example.com' },
    });
    const next = vi.fn();

    await createOwnerMiddleware({ type: 'json' })(c, next);

    expect(next).toHaveBeenCalled();
    expect(jsonMock).not.toHaveBeenCalled();
  });

  it('rejects requests when owner allowlist is missing', async () => {
    const { c, jsonMock } = createMockContext({
      accessUser: { email: 'owner@example.com' },
    });
    const next = vi.fn();

    await createOwnerMiddleware({ type: 'json' })(c, next);

    expect(next).not.toHaveBeenCalled();
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Owner access not configured',
        hint: 'Set ADMIN_ALLOWED_EMAILS to a comma-separated list of Cloudflare Access emails allowed to perform privileged admin actions',
      }),
      503,
    );
  });

  it('rejects non-owner requests with 403', async () => {
    const { c, jsonMock } = createMockContext({
      env: { ADMIN_ALLOWED_EMAILS: 'owner@example.com' },
      accessUser: { email: 'viewer@example.com' },
    });
    const next = vi.fn();

    await createOwnerMiddleware({ type: 'json' })(c, next);

    expect(next).not.toHaveBeenCalled();
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Forbidden',
        hint: 'This route is restricted to configured allowlisted admin accounts',
      }),
      403,
    );
  });

  it('bypasses owner checks in dev mode', async () => {
    const { c, jsonMock } = createMockContext({
      env: { DEV_MODE: 'true' },
    });
    const next = vi.fn();

    await createOwnerMiddleware({ type: 'json' })(c, next);

    expect(next).toHaveBeenCalled();
    expect(jsonMock).not.toHaveBeenCalled();
  });
});
