import 'server-only';
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { sessions, users } from '@/server/db/schema';
import { getEnv } from '@/server/env';
import { nowIso } from '@/lib/datetime';
import type { Principal } from '@/lib/domain';
import { hmac, randomToken } from './tokens';

/**
 * Opaque database-backed sessions.
 *
 * The client only ever holds a random token; the database stores
 * `HMAC-SHA256(SESSION_SECRET, token)`. That means a database leak alone cannot
 * be replayed as a login, and revocation is immediate (unlike a stateless JWT).
 */

export interface CreatedSession {
  /** Raw token — goes in the cookie and is never persisted or logged. */
  token: string;
  tokenHash: string;
  csrfNonce: string;
  expiresAt: string;
  sessionId: number;
}

export interface ResolvedSession {
  sessionId: number;
  principal: Principal;
  tokenHash: string;
  csrfNonce: string;
  expiresAt: string;
}

export function hashSessionToken(token: string): string {
  return hmac(getEnv().SESSION_SECRET, token);
}

export function sessionExpiryFrom(at: Date = new Date()): string {
  const ttlMs = getEnv().SESSION_TTL_HOURS * 60 * 60 * 1000;
  return new Date(at.getTime() + ttlMs).toISOString();
}

export function createSession(userId: number, userAgent: string | null): CreatedSession {
  const db = getDb();
  const token = randomToken(32);
  const tokenHash = hashSessionToken(token);
  const csrfNonce = randomToken(16);
  const expiresAt = sessionExpiryFrom();
  const now = nowIso();

  const inserted = db
    .insert(sessions)
    .values({
      userId,
      tokenHash,
      csrfNonce,
      createdAt: now,
      expiresAt,
      lastSeenAt: now,
      userAgent: userAgent ? userAgent.slice(0, 300) : null,
    })
    .returning({ id: sessions.id })
    .get();

  return { token, tokenHash, csrfNonce, expiresAt, sessionId: inserted.id };
}

/**
 * Resolve a presented cookie value to an active principal.
 * Returns null for unknown, revoked, expired, or disabled-user sessions.
 */
export function resolveSession(token: string): ResolvedSession | null {
  if (!token) return null;
  const db = getDb();
  const tokenHash = hashSessionToken(token);
  const now = nowIso();

  const row = db
    .select({
      sessionId: sessions.id,
      tokenHash: sessions.tokenHash,
      csrfNonce: sessions.csrfNonce,
      expiresAt: sessions.expiresAt,
      lastSeenAt: sessions.lastSeenAt,
      userId: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      status: users.status,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, tokenHash),
        isNull(sessions.revokedAt),
        sql`${sessions.expiresAt} > ${now}`,
        eq(users.status, 'ACTIVE'),
      ),
    )
    .get();

  if (!row) return null;

  touchLastSeen(row.sessionId, row.lastSeenAt, now);

  return {
    sessionId: row.sessionId,
    tokenHash: row.tokenHash,
    csrfNonce: row.csrfNonce,
    expiresAt: row.expiresAt,
    principal: {
      id: row.userId,
      name: row.name,
      email: row.email,
      role: row.role,
      status: row.status,
    },
  };
}

/** Throttled to at most one write per 5 minutes so reads stay read-mostly. */
const LAST_SEEN_THROTTLE_MS = 5 * 60 * 1000;

function touchLastSeen(sessionId: number, lastSeenAt: string | null, now: string): void {
  if (lastSeenAt) {
    const previous = new Date(lastSeenAt).getTime();
    if (Number.isFinite(previous) && Date.now() - previous < LAST_SEEN_THROTTLE_MS) return;
  }
  try {
    getDb().update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, sessionId)).run();
  } catch {
    // A busy writer must not break an otherwise valid read request.
  }
}

export function revokeSession(sessionId: number): void {
  getDb()
    .update(sessions)
    .set({ revokedAt: nowIso() })
    .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)))
    .run();
}

/** Revoke every active session for a user, optionally sparing the current one. */
export function revokeUserSessions(userId: number, exceptSessionId?: number): number {
  const conditions = [eq(sessions.userId, userId), isNull(sessions.revokedAt)];
  if (exceptSessionId !== undefined) {
    conditions.push(sql`${sessions.id} <> ${exceptSessionId}`);
  }
  const result = getDb()
    .update(sessions)
    .set({ revokedAt: nowIso() })
    .where(and(...conditions))
    .run();
  return result.changes;
}

/** Housekeeping: drop rows that can never authenticate again. */
export function purgeDeadSessions(olderThanDays = 30): number {
  const cutoff = new Date(Date.now() - olderThanDays * 86_400_000).toISOString();
  const result = getDb()
    .delete(sessions)
    .where(and(or(lt(sessions.expiresAt, cutoff), lt(sessions.revokedAt, cutoff)), sql`1 = 1`))
    .run();
  return result.changes;
}
