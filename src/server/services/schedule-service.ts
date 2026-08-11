import 'server-only';
import { and, asc, eq, isNull, lte, sql } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { posts, users } from '@/server/db/schema';
import { nowIso } from '@/lib/datetime';
import { logger } from '@/server/logger';
import { publishScheduledPost } from './workflow-service';

/**
 * Scheduled publishing.
 *
 * Runs from both `pnpm jobs:publish-scheduled` and the protected internal
 * endpoint. Each due post is published in its own transaction so one bad row
 * cannot roll back the rest of the batch, and the job is idempotent: a second
 * run finds nothing still in SCHEDULED and does nothing.
 */

export interface PublishRunResult {
  checked: number;
  published: number;
  skipped: number;
  failed: number;
  postIds: number[];
}

/**
 * Actor recorded for automatic publications.
 *
 * `workflow_events.actor_id` is NOT NULL, so the job needs a real user row. It
 * uses the lowest-id active Admin and records `via: "scheduler"` in the audit
 * metadata, which keeps the foreign key honest while staying auditable.
 */
export function resolveSystemActorId(): number | null {
  const admin = getDb()
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, 'ADMIN'), eq(users.status, 'ACTIVE')))
    .orderBy(asc(users.id))
    .get();
  return admin?.id ?? null;
}

export function findDuePosts(now: string = nowIso()): number[] {
  return getDb()
    .select({ id: posts.id })
    .from(posts)
    .where(
      and(
        eq(posts.status, 'SCHEDULED'),
        isNull(posts.deletedAt),
        sql`${posts.scheduledAt} IS NOT NULL`,
        lte(posts.scheduledAt, now),
      ),
    )
    .orderBy(asc(posts.scheduledAt), asc(posts.id))
    .all()
    .map((row) => row.id);
}

export function publishDuePosts(now: Date = new Date(), requestId = 'job'): PublishRunResult {
  const nowIsoValue = now.toISOString();
  const due = findDuePosts(nowIsoValue);

  const result: PublishRunResult = {
    checked: due.length,
    published: 0,
    skipped: 0,
    failed: 0,
    postIds: [],
  };

  if (due.length === 0) return result;

  const systemActorId = resolveSystemActorId();
  if (systemActorId === null) {
    logger.error(
      'Scheduled publishing aborted: no active administrator to attribute the action to.',
    );
    result.failed = due.length;
    return result;
  }

  const db = getDb();

  for (const postId of due) {
    try {
      const published = publishScheduledPost(db, postId, systemActorId, requestId, nowIsoValue);
      if (published) {
        result.published += 1;
        result.postIds.push(postId);
      } else {
        result.skipped += 1;
      }
    } catch (error) {
      result.failed += 1;
      // Log the id and the reason, never the post body.
      logger.error('Scheduled publication failed for one post.', {
        postId,
        reason: error instanceof Error ? error.message : 'unknown',
      });
    }
  }

  return result;
}
