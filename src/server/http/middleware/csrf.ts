import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import {
  isAllowedFetchSite,
  isAllowedOrigin,
  isSafeMethod,
  verifyCsrfToken,
} from '@/server/auth/csrf';
import { getEnv } from '@/server/env';
import { AppError } from '@/server/errors/app-error';
import type { AppBindings } from '../types';

/**
 * CSRF protection for cookie-authenticated mutations.
 *
 * Three independent layers, all required:
 *  1. Origin must match APP_URL (or the request Host) when the browser sends one.
 *  2. `Sec-Fetch-Site` must not say the request is cross-site.
 *  3. A signed, session-bound token must appear identically in the `pf_csrf`
 *     cookie and the `X-CSRF-Token` header.
 *
 * Requests with no session are skipped: there is no ambient authority to abuse.
 */
export const csrfProtection = (): MiddlewareHandler<AppBindings> => async (c, next) => {
  if (isSafeMethod(c.req.method)) {
    await next();
    return;
  }

  const sessionTokenHash = c.get('sessionTokenHash');
  if (!sessionTokenHash) {
    await next();
    return;
  }

  const origin = c.req.header('origin');
  const host = c.req.header('host');
  if (!isAllowedOrigin(origin, host)) {
    throw new AppError('CSRF_FAILED', 'The request origin is not allowed.');
  }

  if (!isAllowedFetchSite(c.req.header('sec-fetch-site'))) {
    throw new AppError('CSRF_FAILED', 'Cross-site requests are not allowed.');
  }

  const env = getEnv();
  const cookieValue = getCookie(c, env.csrfCookieName) ?? getCookie(c, 'pf_csrf');
  const headerValue = c.req.header('x-csrf-token');

  if (!verifyCsrfToken(headerValue, cookieValue, sessionTokenHash)) {
    throw new AppError(
      'CSRF_FAILED',
      'The CSRF token is missing or invalid. Reload the page and try again.',
    );
  }

  await next();
};
