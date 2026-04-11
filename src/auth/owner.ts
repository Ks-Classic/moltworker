import type { Context, Next } from 'hono';
import type { AppEnv, MoltbotEnv } from '../types';
import { isDevMode, isE2ETestMode } from './middleware';

export interface OwnerMiddlewareOptions {
  type: 'json' | 'html';
}

function parseAllowedEmails(env: MoltbotEnv): string[] {
  return (env.ADMIN_ALLOWED_EMAILS || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);
}

function hasOwnerAccess(env: MoltbotEnv, email: string | undefined): boolean {
  if (!email) {
    return false;
  }

  const allowedEmails = parseAllowedEmails(env);
  if (allowedEmails.length === 0) {
    return false;
  }

  return allowedEmails.includes(email.trim().toLowerCase());
}

export function createOwnerMiddleware(options: OwnerMiddlewareOptions) {
  return async (c: Context<AppEnv>, next: Next) => {
    if (isDevMode(c.env) || isE2ETestMode(c.env)) {
      return next();
    }

    const accessUser = c.get('accessUser');
    const allowedEmails = parseAllowedEmails(c.env);

    if (allowedEmails.length === 0) {
      if (options.type === 'json') {
        return c.json(
          {
            error: 'Owner access not configured',
            hint: 'Set ADMIN_ALLOWED_EMAILS to a comma-separated list of Cloudflare Access emails allowed to perform privileged admin actions',
          },
          503,
        );
      }

      return c.html(
        `
        <html>
          <body>
            <h1>Owner Access Not Configured</h1>
            <p>Set ADMIN_ALLOWED_EMAILS to the Cloudflare Access email allowlist for privileged admin/debug routes.</p>
          </body>
        </html>
      `,
        503,
      );
    }

    if (!hasOwnerAccess(c.env, accessUser?.email)) {
      if (options.type === 'json') {
        return c.json(
          {
            error: 'Forbidden',
            hint: 'This route is restricted to configured allowlisted admin accounts',
          },
          403,
        );
      }

      return c.html(
        `
        <html>
          <body>
            <h1>Forbidden</h1>
            <p>This route is restricted to configured allowlisted admin accounts.</p>
          </body>
        </html>
      `,
        403,
      );
    }

    return next();
  };
}

export { hasOwnerAccess, parseAllowedEmails };
