import 'server-only';
import { cookies } from 'next/headers';
import { getEnv } from '@/server/env';
import { resolveSession } from './session';
import type { Principal } from '@/lib/domain';

/**
 * Session lookup for Server Components.
 *
 * The admin layout calls this before rendering anything protected, so an
 * unauthenticated visitor never receives protected markup — the API check is
 * still the authoritative one for data access.
 */
export async function getCurrentUser(): Promise<Principal | null> {
  const env = getEnv();
  const store = await cookies();

  const token =
    store.get(env.sessionCookieName)?.value ??
    store.get(env.SESSION_COOKIE_NAME)?.value ??
    store.get(`__Host-${env.SESSION_COOKIE_NAME}`)?.value;

  if (!token) return null;
  return resolveSession(token)?.principal ?? null;
}
