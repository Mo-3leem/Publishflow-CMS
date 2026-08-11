import 'server-only';
import { and, eq, gte, sql } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { loginAttempts, sessions, users } from '@/server/db/schema';
import { nowIso } from '@/lib/datetime';
import type { Principal, SafeUser } from '@/lib/domain';
import { AppError, GENERIC_LOGIN_FAILURE } from '@/server/errors/app-error';
import { hashPassword, verifyPassword, validatePasswordPolicy } from '@/server/auth/password';
import {
  createSession,
  revokeSession,
  revokeUserSessions,
  type CreatedSession,
} from '@/server/auth/session';
import { hmac, randomToken } from '@/server/auth/tokens';
import { getEnv } from '@/server/env';
import { writeAudit } from './audit-service';
import { normalizeEmail, toSafeUser } from './user-service';
import type { ActorContext } from './context';

/**
 * Authentication flows.
 *
 * Login failures are deliberately indistinguishable: unknown email, wrong
 * password and disabled account all return the same code and message, and the
 * unknown-email path still performs a hash verification so response time does
 * not leak account existence.
 */

const LOGIN_WINDOW_MINUTES = 15;
const LOGIN_MAX_ATTEMPTS = 10;

/**
 * A real Argon2id hash of a value nobody knows, computed once per process.
 *
 * Verifying against it on the unknown-account path burns the same CPU as a real
 * check, so response time does not reveal whether the email exists. A hard-coded
 * literal would not work: a malformed hash makes `verify` fail instantly.
 */
let dummyHashPromise: Promise<string> | null = null;

function getDummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword(`unused-${randomToken(16)}`);
  return dummyHashPromise;
}

export interface LoginInput {
  email: string;
  password: string;
  userAgent: string | null;
  clientKey: string;
  requestId: string;
}

export interface LoginResult {
  user: SafeUser;
  session: CreatedSession;
}

function attemptKey(email: string, clientKey: string): string {
  // Hash so the throttle table never stores a plaintext email or client address.
  return hmac(getEnv().SESSION_SECRET, `login:${email}:${clientKey}`);
}

function windowStart(): string {
  return new Date(Date.now() - LOGIN_WINDOW_MINUTES * 60_000).toISOString();
}

export function countRecentLoginFailures(key: string): number {
  return (
    getDb()
      .select({ count: sql<number>`count(*)` })
      .from(loginAttempts)
      .where(and(eq(loginAttempts.attemptKey, key), gte(loginAttempts.createdAt, windowStart())))
      .get()?.count ?? 0
  );
}

function recordLoginFailure(key: string): void {
  const db = getDb();
  db.insert(loginAttempts).values({ attemptKey: key, createdAt: nowIso() }).run();
  // Keep the table bounded; rows older than the window can never matter again.
  db.delete(loginAttempts)
    .where(sql`${loginAttempts.createdAt} < ${windowStart()}`)
    .run();
}

function clearLoginFailures(key: string): void {
  getDb().delete(loginAttempts).where(eq(loginAttempts.attemptKey, key)).run();
}

export async function login(input: LoginInput): Promise<LoginResult> {
  const email = normalizeEmail(input.email);
  const key = attemptKey(email, input.clientKey);
  const db = getDb();

  if (countRecentLoginFailures(key) >= LOGIN_MAX_ATTEMPTS) {
    writeAudit(db, {
      actorId: null,
      action: 'auth.login.rate_limited',
      entityType: 'auth',
      entityId: null,
      metadata: { window: `${LOGIN_WINDOW_MINUTES}m` },
      requestId: input.requestId,
    });
    throw new AppError(
      'RATE_LIMITED',
      `Too many failed sign-in attempts. Try again in ${LOGIN_WINDOW_MINUTES} minutes.`,
    );
  }

  const row = db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      status: users.status,
      passwordHash: users.passwordHash,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
      lastLoginAt: users.lastLoginAt,
    })
    .from(users)
    .where(eq(users.email, email))
    .get();

  const passwordOk = await verifyPassword(
    row?.passwordHash ?? (await getDummyHash()),
    input.password,
  );

  if (!row || !passwordOk || row.status !== 'ACTIVE') {
    recordLoginFailure(key);
    writeAudit(db, {
      actorId: null,
      action: 'auth.login.failure',
      entityType: 'auth',
      entityId: null,
      // Enough to investigate a real incident, not enough to enumerate accounts
      // from the audit screen alone (it is Admin-only anyway).
      metadata: { emailHash: hmac(getEnv().SESSION_SECRET, email).slice(0, 16) },
      requestId: input.requestId,
    });
    throw new AppError('AUTH_INVALID_CREDENTIALS', GENERIC_LOGIN_FAILURE);
  }

  clearLoginFailures(key);

  const now = nowIso();
  db.update(users).set({ lastLoginAt: now }).where(eq(users.id, row.id)).run();

  // Fresh session token after authentication (no fixation).
  const session = createSession(row.id, input.userAgent);

  writeAudit(db, {
    actorId: row.id,
    action: 'auth.login.success',
    entityType: 'auth',
    entityId: row.id,
    requestId: input.requestId,
  });

  return {
    user: toSafeUser({ ...row, lastLoginAt: now }),
    session,
  };
}

export function logout(ctx: ActorContext, sessionId: number): void {
  revokeSession(sessionId);
  writeAudit(getDb(), {
    actorId: ctx.actor.id,
    action: 'auth.logout',
    entityType: 'auth',
    entityId: ctx.actor.id,
    requestId: ctx.requestId,
  });
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
  userAgent: string | null;
}

/**
 * Change own password.
 *
 * Every other session is revoked and the current one is replaced, so a stolen
 * cookie stops working the moment the legitimate owner rotates their password.
 */
export async function changeOwnPassword(
  ctx: ActorContext,
  currentSessionId: number,
  input: ChangePasswordInput,
): Promise<CreatedSession> {
  const db = getDb();
  const row = db
    .select({ id: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, ctx.actor.id))
    .get();
  if (!row) throw AppError.notFound('User');

  const ok = await verifyPassword(row.passwordHash, input.currentPassword);
  if (!ok) {
    throw AppError.validation('The current password is incorrect.', {
      currentPassword: ['The current password is incorrect.'],
    });
  }

  const policy = validatePasswordPolicy(input.newPassword);
  if (!policy.ok) {
    throw AppError.validation('The new password does not meet the policy.', {
      newPassword: policy.errors,
    });
  }

  if (input.currentPassword === input.newPassword) {
    throw AppError.validation('The new password must differ from the current password.', {
      newPassword: ['The new password must differ from the current password.'],
    });
  }

  const passwordHash = await hashPassword(input.newPassword);

  db.transaction((tx) => {
    tx.update(users)
      .set({ passwordHash, updatedAt: nowIso() })
      .where(eq(users.id, ctx.actor.id))
      .run();

    tx.update(sessions)
      .set({ revokedAt: nowIso() })
      .where(and(eq(sessions.userId, ctx.actor.id), sql`${sessions.revokedAt} IS NULL`))
      .run();

    writeAudit(tx, {
      actorId: ctx.actor.id,
      action: 'auth.password.changed',
      entityType: 'user',
      entityId: ctx.actor.id,
      requestId: ctx.requestId,
    });
  });

  // The old session was revoked above; issue a replacement so the user stays
  // signed in on this device only.
  void currentSessionId;
  return createSession(ctx.actor.id, input.userAgent);
}

export function revokeAllSessionsForUser(userId: number, exceptSessionId?: number): number {
  return revokeUserSessions(userId, exceptSessionId);
}

export function principalFromSafeUser(user: SafeUser): Principal {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
  };
}
