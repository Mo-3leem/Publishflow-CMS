import 'server-only';
import { and, asc, desc, eq, like, ne, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { sessions, users } from '@/server/db/schema';
import { nowIso } from '@/lib/datetime';
import { buildMeta, parsePagination, resolveOrder, resolveSort } from '@/lib/pagination';
import { can } from '@/lib/permissions';
import type { PaginationMeta, Principal, SafeUser, UserRole, UserStatus } from '@/lib/domain';
import { AppError } from '@/server/errors/app-error';
import { hashPassword, validatePasswordPolicy } from '@/server/auth/password';
import { writeAudit } from './audit-service';
import type { ActorContext } from './context';

/**
 * User administration.
 *
 * Two invariants are enforced transactionally rather than by convention:
 *  - the final active Admin can never be disabled or demoted (you would lock
 *    everyone out of settings and user management);
 *  - disabling a user or resetting their password revokes their sessions in the
 *    same transaction, so an open browser tab loses access immediately.
 */

const USER_SORT_FIELDS = ['name', 'email', 'role', 'status', 'createdAt', 'lastLoginAt'] as const;
type UserSortField = (typeof USER_SORT_FIELDS)[number];

const SORT_COLUMNS = {
  name: users.name,
  email: users.email,
  role: users.role,
  status: users.status,
  createdAt: users.createdAt,
  lastLoginAt: users.lastLoginAt,
} as const;

export function toSafeUser(row: {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
}): SafeUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastLoginAt: row.lastLoginAt,
  };
}

const SAFE_COLUMNS = {
  id: users.id,
  name: users.name,
  email: users.email,
  role: users.role,
  status: users.status,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
  lastLoginAt: users.lastLoginAt,
} as const;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function requireUserAdmin(actor: Principal): void {
  if (!can(actor.role, 'user.manage')) {
    throw AppError.forbidden('Only administrators can manage user accounts.');
  }
}

export interface ListUsersQuery {
  page?: unknown;
  pageSize?: unknown;
  q?: string | null;
  role?: UserRole | null;
  status?: UserStatus | null;
  sort?: unknown;
  order?: unknown;
}

export function listUsers(
  actor: Principal,
  query: ListUsersQuery,
): { data: SafeUser[]; meta: PaginationMeta } {
  requireUserAdmin(actor);
  const db = getDb();
  const { page, pageSize, offset } = parsePagination(query.page, query.pageSize);
  const sort = resolveSort<UserSortField>(query.sort, USER_SORT_FIELDS, 'createdAt');
  const order = resolveOrder(query.order, 'desc');

  const conditions: SQL[] = [];
  if (query.q) {
    const needle = `%${query.q.trim()}%`;
    const search = or(like(users.name, needle), like(users.email, needle));
    if (search) conditions.push(search);
  }
  if (query.role) conditions.push(eq(users.role, query.role));
  if (query.status) conditions.push(eq(users.status, query.status));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const total =
    db
      .select({ count: sql<number>`count(*)` })
      .from(users)
      .where(where)
      .get()?.count ?? 0;

  const column = SORT_COLUMNS[sort];
  const rows = db
    .select(SAFE_COLUMNS)
    .from(users)
    .where(where)
    .orderBy(order === 'asc' ? asc(column) : desc(column), asc(users.id))
    .limit(pageSize)
    .offset(offset)
    .all();

  return { data: rows.map(toSafeUser), meta: buildMeta(page, pageSize, total) };
}

export function getUserById(actor: Principal, id: number): SafeUser {
  requireUserAdmin(actor);
  const row = getDb().select(SAFE_COLUMNS).from(users).where(eq(users.id, id)).get();
  if (!row) throw AppError.notFound('User');
  return toSafeUser(row);
}

/** Lightweight list for author filters — any staff member may read it. */
export function listAuthorOptions(): Array<{ id: number; name: string; role: UserRole }> {
  return getDb()
    .select({ id: users.id, name: users.name, role: users.role })
    .from(users)
    .orderBy(asc(users.name))
    .all();
}

export interface CreateUserInput {
  name: string;
  email: string;
  password: string;
  role: UserRole;
}

export async function createUser(ctx: ActorContext, input: CreateUserInput): Promise<SafeUser> {
  requireUserAdmin(ctx.actor);

  const policy = validatePasswordPolicy(input.password);
  if (!policy.ok) {
    throw AppError.validation('The password does not meet the policy.', {
      password: policy.errors,
    });
  }

  const email = normalizeEmail(input.email);
  const db = getDb();

  const existing = db.select({ id: users.id }).from(users).where(eq(users.email, email)).get();
  if (existing) {
    throw new AppError('EMAIL_EXISTS', 'An account with this email address already exists.');
  }

  // Hash outside the transaction: Argon2id is deliberately slow and SQLite
  // allows only one writer at a time.
  const passwordHash = await hashPassword(input.password);
  const now = nowIso();

  return db.transaction((tx) => {
    const inserted = tx
      .insert(users)
      .values({
        name: input.name.trim(),
        email,
        passwordHash,
        role: input.role,
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
      })
      .returning(SAFE_COLUMNS)
      .get();

    writeAudit(tx, {
      actorId: ctx.actor.id,
      action: 'user.created',
      entityType: 'user',
      entityId: inserted.id,
      metadata: { email, role: input.role },
      requestId: ctx.requestId,
    });

    return toSafeUser(inserted);
  });
}

export interface UpdateUserInput {
  name?: string;
  role?: UserRole;
  status?: UserStatus;
}

export function countActiveAdmins(exceptUserId?: number): number {
  const conditions: SQL[] = [eq(users.role, 'ADMIN'), eq(users.status, 'ACTIVE')];
  if (exceptUserId !== undefined) conditions.push(ne(users.id, exceptUserId));
  return (
    getDb()
      .select({ count: sql<number>`count(*)` })
      .from(users)
      .where(and(...conditions))
      .get()?.count ?? 0
  );
}

export function updateUser(ctx: ActorContext, id: number, input: UpdateUserInput): SafeUser {
  requireUserAdmin(ctx.actor);

  if (input.name === undefined && input.role === undefined && input.status === undefined) {
    throw AppError.validation('Provide at least one field to update.');
  }

  const db = getDb();

  return db.transaction((tx) => {
    const current = tx.select(SAFE_COLUMNS).from(users).where(eq(users.id, id)).get();
    if (!current) throw AppError.notFound('User');

    const nextRole = input.role ?? current.role;
    const nextStatus = input.status ?? current.status;

    const losesAdminPower =
      current.role === 'ADMIN' &&
      current.status === 'ACTIVE' &&
      (nextRole !== 'ADMIN' || nextStatus !== 'ACTIVE');

    if (losesAdminPower) {
      const remaining =
        tx
          .select({ count: sql<number>`count(*)` })
          .from(users)
          .where(and(eq(users.role, 'ADMIN'), eq(users.status, 'ACTIVE'), ne(users.id, id)))
          .get()?.count ?? 0;
      if (remaining === 0) {
        throw new AppError(
          'LAST_ACTIVE_ADMIN',
          'This is the last active administrator. Promote another administrator first.',
        );
      }
    }

    const updated = tx
      .update(users)
      .set({
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.role !== undefined ? { role: input.role } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        updatedAt: nowIso(),
      })
      .where(eq(users.id, id))
      .returning(SAFE_COLUMNS)
      .get();

    // Disabling must not leave a live session behind.
    if (nextStatus === 'DISABLED' && current.status === 'ACTIVE') {
      tx.update(sessions)
        .set({ revokedAt: nowIso() })
        .where(and(eq(sessions.userId, id), sql`${sessions.revokedAt} IS NULL`))
        .run();
    }

    writeAudit(tx, {
      actorId: ctx.actor.id,
      action: 'user.updated',
      entityType: 'user',
      entityId: id,
      metadata: {
        changes: {
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.role !== undefined ? { role: input.role } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
        },
        previous: { role: current.role, status: current.status },
      },
      requestId: ctx.requestId,
    });

    if (input.role !== undefined && input.role !== current.role) {
      writeAudit(tx, {
        actorId: ctx.actor.id,
        action: 'user.role_changed',
        entityType: 'user',
        entityId: id,
        metadata: { from: current.role, to: input.role },
        requestId: ctx.requestId,
      });
    }
    if (nextStatus !== current.status) {
      writeAudit(tx, {
        actorId: ctx.actor.id,
        action: nextStatus === 'DISABLED' ? 'user.disabled' : 'user.enabled',
        entityType: 'user',
        entityId: id,
        requestId: ctx.requestId,
      });
    }

    return toSafeUser(updated);
  });
}

export async function resetUserPassword(
  ctx: ActorContext,
  id: number,
  newPassword: string,
): Promise<SafeUser> {
  requireUserAdmin(ctx.actor);

  const policy = validatePasswordPolicy(newPassword);
  if (!policy.ok) {
    throw AppError.validation('The password does not meet the policy.', {
      newPassword: policy.errors,
    });
  }

  const db = getDb();
  const target = db.select(SAFE_COLUMNS).from(users).where(eq(users.id, id)).get();
  if (!target) throw AppError.notFound('User');

  const passwordHash = await hashPassword(newPassword);

  return db.transaction((tx) => {
    const updated = tx
      .update(users)
      .set({ passwordHash, updatedAt: nowIso() })
      .where(eq(users.id, id))
      .returning(SAFE_COLUMNS)
      .get();

    tx.update(sessions)
      .set({ revokedAt: nowIso() })
      .where(and(eq(sessions.userId, id), sql`${sessions.revokedAt} IS NULL`))
      .run();

    writeAudit(tx, {
      actorId: ctx.actor.id,
      action: 'user.password_reset',
      entityType: 'user',
      entityId: id,
      // Never the password itself, not even redacted.
      metadata: { sessionsRevoked: true },
      requestId: ctx.requestId,
    });

    return toSafeUser(updated);
  });
}
