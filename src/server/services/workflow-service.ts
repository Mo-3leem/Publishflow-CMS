import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import { getDb, type Db } from '@/server/db';
import { posts, workflowEvents } from '@/server/db/schema';
import { nowIso } from '@/lib/datetime';
import {
  canPerformTransition,
  getTransition,
  isTransitionAllowed,
  type WorkflowAction,
} from '@/lib/workflow';
import type { PostStatus } from '@/lib/domain';
import { AppError } from '@/server/errors/app-error';
import { writeAudit, type AuditAction } from './audit-service';
import {
  getPostForActor,
  getPostRowOrThrow,
  insertRevision,
  versionConflict,
  type PostDetail,
} from './post-service';
import type { ActorContext } from './context';

/**
 * Workflow transitions.
 *
 * Each transition is one transaction: status change + version bump + revision
 * snapshot + workflow event + audit entry. If any step throws, none of it lands.
 */

const AUDIT_FOR_ACTION: Record<WorkflowAction, AuditAction> = {
  submit: 'post.submitted',
  'request-changes': 'post.changes_requested',
  publish: 'post.published',
  schedule: 'post.scheduled',
  'cancel-schedule': 'post.schedule_cancelled',
  archive: 'post.archived',
  'restore-draft': 'post.restored_draft',
};

export interface WorkflowInput {
  expectedVersion: number;
  comment?: string | null;
  scheduledAt?: string | null;
}

interface TransitionPatch {
  status: PostStatus;
  publishedAt?: string | null;
  scheduledAt?: string | null;
}

function buildPatch(
  action: WorkflowAction,
  to: PostStatus,
  input: WorkflowInput,
  now: string,
): TransitionPatch {
  switch (action) {
    case 'publish':
      // Server owns the publication timestamp; the client never supplies it.
      return { status: to, publishedAt: now, scheduledAt: null };
    case 'schedule':
      return { status: to, scheduledAt: input.scheduledAt ?? null, publishedAt: null };
    case 'cancel-schedule':
      return { status: to, scheduledAt: null };
    case 'restore-draft':
      // Leaving `publishedAt` intact would make an unpublished post look live in
      // any query that trusts the timestamp; clear it with the status.
      return { status: to, publishedAt: null, scheduledAt: null };
    default:
      return { status: to };
  }
}

function validateActionInput(action: WorkflowAction, input: WorkflowInput): void {
  const rule = getTransition(action);

  if (rule.requiresComment) {
    const comment = input.comment?.trim() ?? '';
    if (comment.length < 3 || comment.length > 2000) {
      throw AppError.validation('A review comment between 3 and 2000 characters is required.', {
        comment: ['Explain what needs to change (3–2000 characters).'],
      });
    }
  }

  if (rule.requiresScheduledAt) {
    const value = input.scheduledAt;
    if (!value) {
      throw AppError.validation('A scheduled publication date is required.', {
        scheduledAt: ['Choose a future date and time.'],
      });
    }
    const at = new Date(value);
    if (Number.isNaN(at.getTime())) {
      throw AppError.validation('The scheduled date is not a valid timestamp.', {
        scheduledAt: ['Use an ISO 8601 timestamp.'],
      });
    }
    if (at.getTime() <= Date.now()) {
      throw AppError.validation('The scheduled date must be in the future.', {
        scheduledAt: ['Choose a date and time in the future.'],
      });
    }
  }
}

/** Content that must exist before a post can leave DRAFT. */
function assertPublishable(row: {
  subject: string;
  content: string;
  slug: string;
  categoryId: number;
}): void {
  const problems: Record<string, string[]> = {};
  if (row.subject.trim().length < 3)
    problems.subject = ['A subject of at least 3 characters is required.'];
  if (row.content.trim().length === 0) problems.content = ['Content cannot be empty.'];
  if (row.slug.trim().length < 3) problems.slug = ['A slug of at least 3 characters is required.'];
  if (!row.categoryId) problems.categoryId = ['A category is required.'];
  if (Object.keys(problems).length > 0) {
    throw AppError.validation('The post is missing information required for review.', problems);
  }
}

export function performTransition(
  ctx: ActorContext,
  postId: number,
  action: WorkflowAction,
  input: WorkflowInput,
): PostDetail {
  validateActionInput(action, input);

  const db = getDb();

  db.transaction((tx) => {
    const current = getPostRowOrThrow(tx, postId);
    const rule = getTransition(action);
    const isOwner = current.authorId === ctx.actor.id;

    if (!canPerformTransition(action, ctx.actor.role, isOwner)) {
      throw AppError.forbidden(
        `You are not allowed to ${rule.action.replace('-', ' ')} this post.`,
      );
    }

    if (!isTransitionAllowed(action, current.status)) {
      throw new AppError(
        'INVALID_STATE_TRANSITION',
        `A post with status ${current.status} cannot move to ${rule.to}.`,
        { from: current.status, to: rule.to, action },
      );
    }

    if (action === 'submit' || action === 'publish' || action === 'schedule') {
      assertPublishable(current);
    }

    const now = nowIso();
    const patch = buildPatch(action, rule.to, input, now);

    const result = tx
      .update(posts)
      .set({
        status: patch.status,
        ...(patch.publishedAt !== undefined ? { publishedAt: patch.publishedAt } : {}),
        ...(patch.scheduledAt !== undefined ? { scheduledAt: patch.scheduledAt } : {}),
        version: sql`${posts.version} + 1`,
        updatedAt: now,
      })
      .where(and(eq(posts.id, postId), eq(posts.version, input.expectedVersion)))
      .run();

    if (result.changes === 0) {
      throw versionConflict(current.version, current.updatedAt, input.expectedVersion);
    }

    insertRevision(
      tx,
      postId,
      ctx.actor.id,
      input.comment?.trim() || `Status changed to ${rule.to}`,
    );

    tx.insert(workflowEvents)
      .values({
        postId,
        fromStatus: current.status,
        toStatus: rule.to,
        actorId: ctx.actor.id,
        comment: input.comment?.trim() || null,
        createdAt: now,
      })
      .run();

    writeAudit(tx, {
      actorId: ctx.actor.id,
      action: AUDIT_FOR_ACTION[action],
      entityType: 'post',
      entityId: postId,
      metadata: {
        from: current.status,
        to: rule.to,
        slug: current.slug,
        ...(patch.scheduledAt ? { scheduledAt: patch.scheduledAt } : {}),
      },
      requestId: ctx.requestId,
    });
  });

  return getPostForActor(ctx.actor, postId);
}

/**
 * Publish one due scheduled post inside its own transaction.
 *
 * Used by the scheduled-publishing job. Returns false when the row is no longer
 * SCHEDULED, which makes a repeated run a no-op rather than a duplicate event.
 */
export function publishScheduledPost(
  db: Db,
  postId: number,
  systemActorId: number,
  requestId: string,
  now: string,
): boolean {
  return db.transaction((tx) => {
    const current = tx
      .select()
      .from(posts)
      .where(
        and(eq(posts.id, postId), eq(posts.status, 'SCHEDULED'), sql`${posts.deletedAt} IS NULL`),
      )
      .get();

    if (!current) return false;

    const result = tx
      .update(posts)
      .set({
        status: 'PUBLISHED',
        publishedAt: current.scheduledAt ?? now,
        scheduledAt: null,
        version: sql`${posts.version} + 1`,
        updatedAt: now,
      })
      .where(and(eq(posts.id, postId), eq(posts.version, current.version)))
      .run();

    if (result.changes === 0) return false;

    insertRevision(tx, postId, systemActorId, 'Published by the scheduler');

    tx.insert(workflowEvents)
      .values({
        postId,
        fromStatus: 'SCHEDULED',
        toStatus: 'PUBLISHED',
        actorId: systemActorId,
        comment: 'Automatically published by the scheduled publishing job.',
        createdAt: now,
      })
      .run();

    writeAudit(tx, {
      actorId: systemActorId,
      action: 'post.published',
      entityType: 'post',
      entityId: postId,
      metadata: { via: 'scheduler', slug: current.slug },
      requestId,
    });

    return true;
  });
}
