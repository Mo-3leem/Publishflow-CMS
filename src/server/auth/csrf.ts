import 'server-only';
import { getEnv } from '@/server/env';
import { hmac, randomToken, safeEqual } from './tokens';

/**
 * Signed, session-bound double-submit CSRF tokens.
 *
 * Token format: `<nonce>.<hmac(CSRF_SECRET, nonce + "." + sessionTokenHash)>`.
 *
 * Binding the signature to the session token hash means a token minted for one
 * session cannot be replayed against another, and an attacker who can set
 * cookies still cannot forge the matching header value without CSRF_SECRET.
 */

export function issueCsrfToken(sessionTokenHash: string, nonce?: string): string {
  const value = nonce ?? randomToken(16);
  const signature = hmac(getEnv().CSRF_SECRET, `${value}.${sessionTokenHash}`);
  return `${value}.${signature}`;
}

export function verifyCsrfToken(
  token: string | undefined | null,
  cookieValue: string | undefined | null,
  sessionTokenHash: string,
): boolean {
  if (!token || !cookieValue) return false;
  // Double-submit: header and cookie must be identical...
  if (!safeEqual(token, cookieValue)) return false;

  const separator = token.lastIndexOf('.');
  if (separator <= 0) return false;

  const nonce = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!nonce || !signature) return false;

  // ...and the signature must be ours, bound to this exact session.
  const expected = hmac(getEnv().CSRF_SECRET, `${nonce}.${sessionTokenHash}`);
  return safeEqual(signature, expected);
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isSafeMethod(method: string): boolean {
  return SAFE_METHODS.has(method.toUpperCase());
}

/**
 * Origin check for cookie-authenticated mutations.
 *
 * Hono's CSRF middleware only inspects form content types, so JSON mutations get
 * this explicit check. Browsers always send `Origin` on cross-origin unsafe
 * requests; non-browser clients (tests, curl, the cron job) send none, which is
 * allowed because they carry no ambient cookies.
 */
export function isAllowedOrigin(
  origin: string | undefined | null,
  host: string | undefined | null,
): boolean {
  if (!origin) return true;

  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }

  const appUrl = new URL(getEnv().APP_URL);
  if (originUrl.host === appUrl.host && originUrl.protocol === appUrl.protocol) return true;

  // Also accept the literal Host header so the app works behind a proxy or on a
  // LAN address without reconfiguring APP_URL for every environment.
  return Boolean(host) && originUrl.host === host;
}

/** `Sec-Fetch-Site` blocks cross-site requests in browsers that send it. */
export function isAllowedFetchSite(secFetchSite: string | undefined | null): boolean {
  if (!secFetchSite) return true;
  return secFetchSite === 'same-origin' || secFetchSite === 'same-site' || secFetchSite === 'none';
}
