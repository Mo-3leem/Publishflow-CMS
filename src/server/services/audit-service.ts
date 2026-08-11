import 'server-only';
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { getDb, type Db } from '@/server/db';
import { auditLogs, users } from '@/server/db/schema';
import { nowIso } from '@/lib/datetime';
import { buildMeta, parsePagination } from '@/lib/pagination';
import { can } from '@/lib/permissions';
import type { PaginationMeta, Principal } from '@/lib/domain';
import { AppError } from '@/server/errors/app-error';

/**
 * Append-only audit trail for security-relevant actions.
 *
 * `writeAudit` accepts an explicit `Db` so it can join the caller's transaction —
 * a published post and its audit entry must commit or roll back together.
 */

export const AUDIT_ACTIONS = [
  'auth.login.success',
  'auth.login.failure',
  'auth.login.rate_limited',
  'auth.logout',
  'auth.password.changed',
  'user.created',
  'user.updated',
  'user.role_changed',
  'user.disabled',
  'user.enabled',
  'user.password_reset',
  'category.created',
  'category.updated',
  'category.deleted',
  'post.created',
  'post.updated',
  'post.deleted',
  'post.submitted',
  'post.changes_requested',
  'post.published',
  'post.scheduled',
  'post.schedule_cancelled',
  'post.archived',
  'post.restored_draft',
  'revision.restored',
  'menu.item_created',
  'menu.item_updated',
  'menu.item_deleted',
  'menu.reordered',
  'media.uploaded',
  'media.updated',
  'media.deleted',
  'settings.updated',
  'job.publish_scheduled',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditInput {
  actorId: number | null;
  action: AuditAction;
  entityType: string;
  entityId?: string | number | null;
  metadata?: Record<string, unknown>;
  requestId?: string | null;
}

export function writeAudit(db: Db, input: AuditInput): void {
  db.insert(auditLogs)
    .values({
      actorId: input.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId == null ? null : String(input.entityId),
      metadataJson: input.metadata ? JSON.stringify(input.metadata) : null,
      requestId: input.requestId ?? null,
      createdAt: nowIso(),
    })
    .run();
}

export interface AuditLogEntry {
  id: number;
  actorId: number | null;
  actorName: string | null;
  actorEmail: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  requestId: string | null;
  createdAt: string;
}

export interface AuditQuery {
  page?: unknown;
  pageSize?: unknown;
  actorId?: number | null;
  action?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  from?: string | null;
  to?: string | null;
}

export function listAuditLogs(
  actor: Principal,
  query: AuditQuery,
): { data: AuditLogEntry[]; meta: PaginationMeta } {
  if (!can(actor.role, 'audit.view')) {
    throw AppError.forbidden('Only administrators can read the audit log.');
  }

  const db = getDb();
  const { page, pageSize, offset } = parsePagination(query.page, query.pageSize, 25);

  const conditions: SQL[] = [];
  if (query.actorId != null) conditions.push(eq(auditLogs.actorId, query.actorId));
  if (query.action) conditions.push(eq(auditLogs.action, query.action));
  if (query.entityType) conditions.push(eq(auditLogs.entityType, query.entityType));
  if (query.entityId) conditions.push(eq(auditLogs.entityId, query.entityId));
  if (query.from) conditions.push(gte(auditLogs.createdAt, query.from));
  if (query.to) conditions.push(lte(auditLogs.createdAt, query.to));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const total =
    db
      .select({ count: sql<number>`count(*)` })
      .from(auditLogs)
      .where(where)
      .get()?.count ?? 0;

  const rows = db
    .select({
      id: auditLogs.id,
      actorId: auditLogs.actorId,
      actorName: users.name,
      actorEmail: users.email,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      metadataJson: auditLogs.metadataJson,
      requestId: auditLogs.requestId,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorId))
    .where(where)
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
    .limit(pageSize)
    .offset(offset)
    .all();

  const data: AuditLogEntry[] = rows.map((row) => ({
    id: row.id,
    actorId: row.actorId,
    actorName: row.actorName,
    actorEmail: row.actorEmail,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    metadata: parseMetadata(row.metadataJson),
    requestId: row.requestId,
    createdAt: row.createdAt,
  }));

  return { data, meta: buildMeta(page, pageSize, total) };
}

function parseMetadata(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : { value: parsed };
  } catch {
    return null;
  }
}

/** Distinct actions/entity types, for the audit screen filter dropdowns. */
export function listAuditFacets(actor: Principal): { actions: string[]; entityTypes: string[] } {
  if (!can(actor.role, 'audit.view')) {
    throw AppError.forbidden('Only administrators can read the audit log.');
  }
  const db = getDb();
  const actions = db
    .selectDistinct({ action: auditLogs.action })
    .from(auditLogs)
    .orderBy(auditLogs.action)
    .all()
    .map((row) => row.action);
  const entityTypes = db
    .selectDistinct({ entityType: auditLogs.entityType })
    .from(auditLogs)
    .orderBy(auditLogs.entityType)
    .all()
    .map((row) => row.entityType);
  return { actions, entityTypes };
}

export function auditActionLabel(action: string): string {
  const [scope, ...rest] = action.split('.');
  const verb = rest.join(' ').replace(/_/g, ' ');
  return `${(scope ?? '').replace(/^\w/, (c) => c.toUpperCase())}: ${verb}`;
}

/** Filter helper shared by list route and admin screen. */
export function isKnownAuditAction(value: string): value is AuditAction {
  return (AUDIT_ACTIONS as readonly string[]).includes(value);
}
