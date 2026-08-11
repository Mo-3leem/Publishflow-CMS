import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { resolveSession } from '@/server/auth/session';
import { safeEqual } from '@/server/auth/tokens';
import { getEnv } from '@/server/env';
import { AppError } from '@/server/errors/app-error';
import { can, type Capability } from '@/lib/permissions';
import type { AppBindings } from '../types';

/**
 * Session resolution and role gates.
 *
 * `loadSession` is permissive (it only populates context); the `require*`
 * middlewares are the gates. Every protected route names its own requirement so
 * a new route cannot accidentally inherit "public" by omission.
 */

export const loadSession = (): MiddlewareHandler<AppBindings> => async (c, next) => {
  const env = getEnv();
  // Accept both the plain and __Host- prefixed names so a environment switch
  // does not silently sign everyone out.
  const token =
    getCookie(c, env.sessionCookieName) ??
    getCookie(c, env.SESSION_COOKIE_NAME) ??
    getCookie(c, `__Host-${env.SESSION_COOKIE_NAME}`);

  if (token) {
    const session = resolveSession(token);
    if (session) {
      c.set('principal', session.principal);
      c.set('sessionId', session.sessionId);
      c.set('sessionTokenHash', session.tokenHash);
      c.set('csrfNonce', session.csrfNonce);
    }
  }

  await next();
};

export const requireAuth = (): MiddlewareHandler<AppBindings> => async (c, next) => {
  if (!c.get('principal')) {
    throw AppError.authRequired('You must sign in to use this endpoint.');
  }
  await next();
};

export const requireCapability =
  (capability: Capability): MiddlewareHandler<AppBindings> =>
  async (c, next) => {
    const principal = c.get('principal');
    if (!principal) throw AppError.authRequired();
    if (!can(principal.role, capability)) {
      throw AppError.forbidden('Your role does not allow this operation.');
    }
    await next();
  };

/** Bearer-secret gate for the internal scheduled-publishing endpoint. */
export const requireJobSecret = (): MiddlewareHandler<AppBindings> => async (c, next) => {
  const header = c.req.header('authorization') ?? '';
  const expected = `Bearer ${getEnv().SCHEDULE_JOB_SECRET}`;

  if (!safeEqual(header, expected)) {
    throw AppError.authRequired('A valid job secret is required.');
  }
  await next();
};
