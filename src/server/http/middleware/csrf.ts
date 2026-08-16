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

/**
 * Paths exempt from layer 3 — the token — and from that alone.
 *
 * The bar for membership is that the endpoint never acts on the session's
 * authority. `POST /public/posts/:slug/view` qualifies: it identifies the reader
 * by an opaque visitor cookie, never reads the session, writes only an
 * idempotent per-(post, viewer, UTC day) analytics row, and returns a number the
 * article page already displays to everyone. Forging it cross-site would gain an
 * attacker nothing they could not get by calling the same public endpoint
 * directly with their own cookie jar.
 *
 * Without this, a staff member reading the public site was silently uncounted:
 * the ViewTracker is a public component with no token to send, so the mere
 * presence of a session turned a public analytics ping into a 403.
 *
 * `c.req.path` is Hono's normalised pathname — `..` segments are already
 * collapsed and the query string removed before this runs — so the anchored
 * single-segment pattern cannot be widened by traversal or a query suffix.
 */
const CSRF_TOKEN_EXEMPT_PATHS: readonly RegExp[] = [/^\/api\/v1\/public\/posts\/[^/]+\/view$/];

function isTokenExemptPath(path: string): boolean {
  return CSRF_TOKEN_EXEMPT_PATHS.some((pattern) => pattern.test(path));
}

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

  // Deliberately after the origin and Sec-Fetch-Site checks, so an exempt
  // endpoint still refuses cross-origin and cross-site callers. Only the token
  // requirement is waived, and only for the paths listed above.
  if (isTokenExemptPath(c.req.path)) {
    await next();
    return;
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
