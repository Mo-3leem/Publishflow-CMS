import type { Context } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import { getEnv } from '@/server/env';
import { issueCsrfToken } from '@/server/auth/csrf';
import type { AppBindings } from './types';

/**
 * Cookie helpers.
 *
 * Session cookie: HttpOnly, SameSite=Lax, Secure in production, `__Host-`
 * prefixed when Secure so it cannot be set by a sibling subdomain.
 * CSRF cookie: deliberately readable by JavaScript — it is the "double submit"
 * half that the client echoes back in `X-CSRF-Token`.
 */

export function setSessionCookie(c: Context<AppBindings>, token: string, expiresAt: string): void {
  const env = getEnv();
  const maxAge = Math.max(1, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));

  setCookie(c, env.sessionCookieName, token, {
    httpOnly: true,
    secure: env.secureCookies,
    sameSite: 'Lax',
    path: '/',
    maxAge,
  });
}

export function clearSessionCookie(c: Context<AppBindings>): void {
  const env = getEnv();
  for (const name of [env.sessionCookieName, env.SESSION_COOKIE_NAME]) {
    deleteCookie(c, name, { path: '/', secure: env.secureCookies });
  }
}

export function setCsrfCookie(c: Context<AppBindings>, sessionTokenHash: string): string {
  const env = getEnv();
  const token = issueCsrfToken(sessionTokenHash);

  setCookie(c, env.csrfCookieName, token, {
    httpOnly: false,
    secure: env.secureCookies,
    sameSite: 'Lax',
    path: '/',
    maxAge: env.SESSION_TTL_HOURS * 3600,
  });

  return token;
}

export function clearCsrfCookie(c: Context<AppBindings>): void {
  const env = getEnv();
  for (const name of [env.csrfCookieName, 'pf_csrf']) {
    deleteCookie(c, name, { path: '/', secure: env.secureCookies });
  }
}

export const VISITOR_COOKIE_MAX_AGE = 400 * 24 * 3600;

export function setVisitorCookie(c: Context<AppBindings>, visitorId: string): void {
  const env = getEnv();
  setCookie(c, env.visitorCookieName, visitorId, {
    httpOnly: true,
    secure: env.secureCookies,
    sameSite: 'Lax',
    path: '/',
    maxAge: VISITOR_COOKIE_MAX_AGE,
  });
}
