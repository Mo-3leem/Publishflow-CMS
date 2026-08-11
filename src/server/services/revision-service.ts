import 'server-only';
import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { postRevisions, posts, users } from '@/server/db/schema';
import { nowIso } from '@/lib/datetime';
import { can, canViewRevisions } from '@/lib/permissions';
import type { PostStatus, Principal } from '@/lib/domain';
import { AppError } from '@/server/errors/app-error';
import { writeAudit } from './audit-service';
import {
  getPostForActor,
  getPostRowOrThrow,
  insertRevision,
  versionConflict,
  type PostDetail,
} from './post-service';
import type { ActorContext } from './context';

/**
 * Revision history.
 *
 * History is append-only. Restoring an old revision writes the old *content*
 * forward as a brand new version — it never rewrites or deletes a stored row, so
 * the trail of what happened stays intact even after a mistake is undone.
 */

export interface RevisionSummary {
  id: number;
  postId: number;
  version: number;
  subject: string;
  slug: string;
  status: string;
  changeSummary: string | null;
  savedBy: number;
  savedByName: string;
  createdAt: string;
  isCurrent: boolean;
}

export interface RevisionDetail extends RevisionSummary {
  categoryId: number;
  featuredImageId: number | null;
  excerpt: string;
  content: string;
  sourceUrl: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  scheduledAt: string | null;
  publishedAt: string | null;
}

function assertCanView(actor: Principal, postId: number): { authorId: number; version: number } {
  const post = getDb()
    .select({ authorId: posts.authorId, version: posts.version })
    .from(posts)
    .where(and(eq(posts.id, postId), sql`${posts.deletedAt} IS NULL`))
    .get();
  if (!post) throw AppError.notFound('Post');
  if (!canViewRevisions(actor.role, actor.id, post.authorId)) {
    throw AppError.notFound('Post');
  }
  return post;
}

export function listRevisions(actor: Principal, postId: number): RevisionSummary[] {
  const post = assertCanView(actor, postId);

  return getDb()
    .select({
      id: postRevisions.id,
      postId: postRevisions.postId,
      version: postRevisions.version,
      subject: postRevisions.subject,
      slug: postRevisions.slug,
      status: postRevisions.status,
      changeSummary: postRevisions.changeSummary,
      savedBy: postRevisions.savedBy,
      savedByName: users.name,
      createdAt: postRevisions.createdAt,
    })
    .from(postRevisions)
    .innerJoin(users, eq(users.id, postRevisions.savedBy))
    .where(eq(postRevisions.postId, postId))
    .orderBy(desc(postRevisions.version), desc(postRevisions.id))
    .all()
    .map((row) => ({ ...row, isCurrent: row.version === post.version }));
}

export function getRevision(actor: Principal, postId: number, revisionId: number): RevisionDetail {
  const post = assertCanView(actor, postId);

  const row = getDb()
    .select({
      id: postRevisions.id,
      postId: postRevisions.postId,
      version: postRevisions.version,
      categoryId: postRevisions.categoryId,
      featuredImageId: postRevisions.featuredImageId,
      subject: postRevisions.subject,
      slug: postRevisions.slug,
      excerpt: postRevisions.excerpt,
      content: postRevisions.content,
      sourceUrl: postRevisions.sourceUrl,
      status: postRevisions.status,
      seoTitle: postRevisions.seoTitle,
      seoDescription: postRevisions.seoDescription,
      scheduledAt: postRevisions.scheduledAt,
      publishedAt: postRevisions.publishedAt,
      changeSummary: postRevisions.changeSummary,
      savedBy: postRevisions.savedBy,
      savedByName: users.name,
      createdAt: postRevisions.createdAt,
    })
    .from(postRevisions)
    .innerJoin(users, eq(users.id, postRevisions.savedBy))
    .where(and(eq(postRevisions.postId, postId), eq(postRevisions.id, revisionId)))
    .get();

  if (!row) throw AppError.notFound('Revision');
  return { ...row, isCurrent: row.version === post.version };
}

export interface RestoreRevisionInput {
  expectedVersion: number;
  changeSummary?: string | null;
}

/**
 * Restore a revision's content as a new current version.
 *
 * Status and publication metadata are intentionally NOT restored: bringing back
 * an old body must not silently republish an archived post or resurrect a stale
 * publication date. Only the editable content fields move forward.
 */
export function restoreRevision(
  ctx: ActorContext,
  postId: number,
  revisionId: number,
  input: RestoreRevisionInput,
): PostDetail {
  if (!can(ctx.actor.role, 'revision.restore')) {
    throw AppError.forbidden('Only administrators and editors can restore revisions.');
  }

  const db = getDb();

  db.transaction((tx) => {
    const current = getPostRowOrThrow(tx, postId);

    const revision = tx
      .select()
      .from(postRevisions)
      .where(and(eq(postRevisions.postId, postId), eq(postRevisions.id, revisionId)))
      .get();
    if (!revision) throw AppError.notFound('Revision');

    // The revision's slug may have been taken by another post in the meantime.
    const slugOwner = tx
      .select({ id: posts.id })
      .from(posts)
      .where(and(eq(posts.slug, revision.slug), sql`${posts.id} <> ${postId}`))
      .get();
    const slug = slugOwner ? current.slug : revision.slug;

    const result = tx
      .update(posts)
      .set({
        categoryId: revision.categoryId,
        featuredImageId: revision.featuredImageId,
        subject: revision.subject,
        slug,
        excerpt: revision.excerpt,
        content: revision.content,
        sourceUrl: revision.sourceUrl,
        seoTitle: revision.seoTitle,
        seoDescription: revision.seoDescription,
        version: sql`${posts.version} + 1`,
        updatedAt: nowIso(),
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
      input.changeSummary?.trim() || `Restored content from version ${revision.version}`,
    );

    writeAudit(tx, {
      actorId: ctx.actor.id,
      action: 'revision.restored',
      entityType: 'post',
      entityId: postId,
      metadata: {
        restoredFromVersion: revision.version,
        revisionId,
        newVersion: input.expectedVersion + 1,
        slugKept: Boolean(slugOwner),
      },
      requestId: ctx.requestId,
    });
  });

  return getPostForActor(ctx.actor, postId);
}

/** Line-based diff input for the revision comparison screen. */
export function getRevisionPair(
  actor: Principal,
  postId: number,
  leftId: number,
  rightId: number,
): { left: RevisionDetail; right: RevisionDetail } {
  return {
    left: getRevision(actor, postId, leftId),
    right: getRevision(actor, postId, rightId),
  };
}

export function currentStatusOf(postId: number): PostStatus {
  const row = getDb()
    .select({ status: posts.status })
    .from(posts)
    .where(eq(posts.id, postId))
    .get();
  if (!row) throw AppError.notFound('Post');
  return row.status;
}
