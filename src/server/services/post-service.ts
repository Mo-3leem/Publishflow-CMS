import 'server-only';
import { and, asc, desc, eq, inArray, isNull, like, ne, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { getDb, type Db } from '@/server/db';
import {
  categories,
  mediaAssets,
  postRevisions,
  posts,
  users,
  workflowEvents,
} from '@/server/db/schema';
import { nowIso } from '@/lib/datetime';
import { buildMeta, parsePagination, resolveOrder, resolveSort } from '@/lib/pagination';
import { can, canEditPost, canReadPost } from '@/lib/permissions';
import { isValidSlug, normalizeSlug, uniqueSlug } from '@/lib/slug';
import { isSafeExternalUrl } from '@/lib/url-safety';
import { deriveExcerpt } from '@/lib/utils';
import {
  POST_SORT_FIELDS,
  type PaginationMeta,
  type PostSortField,
  type PostStatus,
  type Principal,
} from '@/lib/domain';
import { AppError } from '@/server/errors/app-error';
import { writeAudit } from './audit-service';
import type { ActorContext } from './context';

/**
 * Post CRUD.
 *
 * Two rules dominate this file:
 *  1. Every mutation carries an `expectedVersion` and updates with
 *     `WHERE id = ? AND version = ?`. Zero affected rows means somebody else got
 *     there first — a 409, never a silent overwrite.
 *  2. Version bump, revision snapshot and audit entry share one transaction, so
 *     history can never disagree with the current row.
 */

export interface PostListItem {
  id: number;
  subject: string;
  slug: string;
  excerpt: string;
  status: PostStatus;
  categoryId: number;
  categoryTitle: string;
  categorySlug: string;
  authorId: number;
  authorName: string;
  readsCount: number;
  version: number;
  featuredImageId: number | null;
  featuredImageAlt: string | null;
  scheduledAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PostDetail extends PostListItem {
  content: string;
  sourceUrl: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  deletedAt: string | null;
}

/** Columns for list endpoints — deliberately excludes `content`. */
const LIST_COLUMNS = {
  id: posts.id,
  subject: posts.subject,
  slug: posts.slug,
  excerpt: posts.excerpt,
  status: posts.status,
  categoryId: posts.categoryId,
  categoryTitle: categories.title,
  categorySlug: categories.slug,
  authorId: posts.authorId,
  authorName: users.name,
  readsCount: posts.readsCount,
  version: posts.version,
  featuredImageId: posts.featuredImageId,
  featuredImageAlt: mediaAssets.altText,
  scheduledAt: posts.scheduledAt,
  publishedAt: posts.publishedAt,
  createdAt: posts.createdAt,
  updatedAt: posts.updatedAt,
} as const;

const DETAIL_COLUMNS = {
  ...LIST_COLUMNS,
  content: posts.content,
  sourceUrl: posts.sourceUrl,
  seoTitle: posts.seoTitle,
  seoDescription: posts.seoDescription,
  deletedAt: posts.deletedAt,
} as const;

/** Sort allow-list: user input selects a key here, never a raw column name. */
const SORT_COLUMNS = {
  updatedAt: posts.updatedAt,
  createdAt: posts.createdAt,
  publishedAt: posts.publishedAt,
  subject: posts.subject,
  readsCount: posts.readsCount,
  status: posts.status,
} satisfies Record<PostSortField, SQLiteColumn>;

function baseQuery(db: Db) {
  return db
    .select(LIST_COLUMNS)
    .from(posts)
    .innerJoin(categories, eq(categories.id, posts.categoryId))
    .innerJoin(users, eq(users.id, posts.authorId))
    .leftJoin(mediaAssets, eq(mediaAssets.id, posts.featuredImageId));
}

export interface ListPostsQuery {
  page?: unknown;
  pageSize?: unknown;
  status?: PostStatus | null;
  categoryId?: number | null;
  authorId?: number | null;
  q?: string | null;
  sort?: unknown;
  order?: unknown;
  includeDeleted?: boolean;
}

/**
 * Admin post list.
 *
 * Authors are scoped to their own rows at the SQL level, so an Author cannot
 * page through other people's drafts by guessing query parameters.
 */
export function listPosts(
  actor: Principal,
  query: ListPostsQuery,
): { data: PostListItem[]; meta: PaginationMeta } {
  const db = getDb();
  const { page, pageSize, offset } = parsePagination(query.page, query.pageSize);
  const sort = resolveSort<PostSortField>(query.sort, POST_SORT_FIELDS, 'updatedAt');
  const order = resolveOrder(query.order, 'desc');

  const conditions: SQL[] = [];
  if (!query.includeDeleted) conditions.push(isNull(posts.deletedAt));

  if (!can(actor.role, 'post.readAll')) {
    conditions.push(eq(posts.authorId, actor.id));
  } else if (query.authorId != null) {
    conditions.push(eq(posts.authorId, query.authorId));
  }

  if (query.status) conditions.push(eq(posts.status, query.status));
  if (query.categoryId != null) conditions.push(eq(posts.categoryId, query.categoryId));

  if (query.q && query.q.trim().length > 0) {
    const needle = `%${query.q.trim().slice(0, 200)}%`;
    const search = or(
      like(posts.subject, needle),
      like(posts.excerpt, needle),
      like(posts.slug, needle),
    );
    if (search) conditions.push(search);
  }

  const where = and(...conditions);

  const total =
    db
      .select({ count: sql<number>`count(*)` })
      .from(posts)
      .where(where)
      .get()?.count ?? 0;

  const column = SORT_COLUMNS[sort];
  const rows = baseQuery(db)
    .where(where)
    .orderBy(order === 'asc' ? asc(column) : desc(column), desc(posts.id))
    .limit(pageSize)
    .offset(offset)
    .all();

  return { data: rows as PostListItem[], meta: buildMeta(page, pageSize, total) };
}

/** Load a post for staff editing, enforcing read permission. */
export function getPostForActor(actor: Principal, id: number): PostDetail {
  const db = getDb();
  const row = db
    .select(DETAIL_COLUMNS)
    .from(posts)
    .innerJoin(categories, eq(categories.id, posts.categoryId))
    .innerJoin(users, eq(users.id, posts.authorId))
    .leftJoin(mediaAssets, eq(mediaAssets.id, posts.featuredImageId))
    .where(and(eq(posts.id, id), isNull(posts.deletedAt)))
    .get();

  if (!row) throw AppError.notFound('Post');
  if (!canReadPost(actor.role, actor.id, row.authorId)) {
    // Do not distinguish "exists but forbidden" from "missing" for other
    // authors' private drafts.
    throw AppError.notFound('Post');
  }
  return row as PostDetail;
}

export function getPostRowOrThrow(db: Db, id: number) {
  const row = db
    .select()
    .from(posts)
    .where(and(eq(posts.id, id), isNull(posts.deletedAt)))
    .get();
  if (!row) throw AppError.notFound('Post');
  return row;
}

export function slugTaken(db: Db, slug: string, exceptId?: number): boolean {
  const conditions = [eq(posts.slug, slug)];
  if (exceptId !== undefined) conditions.push(ne(posts.id, exceptId));
  // Soft-deleted rows still reserve their slug so an old public link cannot be
  // taken over by unrelated content.
  return (
    db
      .select({ id: posts.id })
      .from(posts)
      .where(and(...conditions))
      .get() !== undefined
  );
}

/** Snapshot the current post row into `post_revisions`. Caller supplies the tx. */
export function insertRevision(
  db: Db,
  postId: number,
  savedBy: number,
  changeSummary: string | null,
): void {
  const row = db.select().from(posts).where(eq(posts.id, postId)).get();
  if (!row) throw AppError.notFound('Post');

  db.insert(postRevisions)
    .values({
      postId: row.id,
      version: row.version,
      categoryId: row.categoryId,
      featuredImageId: row.featuredImageId,
      subject: row.subject,
      slug: row.slug,
      excerpt: row.excerpt,
      content: row.content,
      sourceUrl: row.sourceUrl,
      status: row.status,
      seoTitle: row.seoTitle,
      seoDescription: row.seoDescription,
      scheduledAt: row.scheduledAt,
      publishedAt: row.publishedAt,
      savedBy,
      changeSummary,
      createdAt: nowIso(),
    })
    .run();
}

function assertCategoryUsable(db: Db, categoryId: number): void {
  const category = db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.id, categoryId))
    .get();
  if (!category) {
    throw AppError.validation('The selected category does not exist.', {
      categoryId: ['Unknown category.'],
    });
  }
}

function assertMediaUsable(db: Db, mediaId: number | null): void {
  if (mediaId == null) return;
  const asset = db
    .select({ id: mediaAssets.id })
    .from(mediaAssets)
    .where(and(eq(mediaAssets.id, mediaId), isNull(mediaAssets.deletedAt)))
    .get();
  if (!asset) {
    throw AppError.validation('The selected image does not exist.', {
      featuredImageId: ['Unknown media asset.'],
    });
  }
}

function assertSourceUrl(sourceUrl: string | null | undefined): void {
  if (sourceUrl == null || sourceUrl === '') return;
  if (!isSafeExternalUrl(sourceUrl)) {
    throw AppError.validation('The source URL must be an absolute http(s) address.', {
      sourceUrl: ['Use a complete http:// or https:// URL.'],
    });
  }
}

export interface CreatePostInput {
  categoryId: number;
  subject: string;
  slug?: string | null;
  excerpt?: string | null;
  content: string;
  sourceUrl?: string | null;
  featuredImageId?: number | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
}

/**
 * Create a Draft.
 *
 * `authorId` is always the caller: the API never accepts an author from the
 * payload, so an Author cannot publish under somebody else's name.
 */
export function createPost(ctx: ActorContext, input: CreatePostInput): PostDetail {
  if (!can(ctx.actor.role, 'post.create')) {
    throw AppError.forbidden('You cannot create posts.');
  }

  assertSourceUrl(input.sourceUrl);
  const db = getDb();

  const newId = db.transaction((tx) => {
    assertCategoryUsable(tx, input.categoryId);
    assertMediaUsable(tx, input.featuredImageId ?? null);

    let slug: string;
    if (input.slug) {
      slug = normalizeSlug(input.slug);
      if (!isValidSlug(slug)) {
        throw AppError.validation(
          'The slug must contain only lowercase letters, numbers and hyphens.',
          {
            slug: ['Use lowercase letters, numbers and hyphens only.'],
          },
        );
      }
      if (slugTaken(tx, slug)) {
        throw new AppError('SLUG_EXISTS', 'Another post already uses this slug.');
      }
    } else {
      slug = uniqueSlug(input.subject, (candidate) => slugTaken(tx, candidate));
    }

    const now = nowIso();
    const excerpt = (input.excerpt ?? '').trim() || deriveExcerpt(input.content);

    const inserted = tx
      .insert(posts)
      .values({
        categoryId: input.categoryId,
        authorId: ctx.actor.id,
        featuredImageId: input.featuredImageId ?? null,
        subject: input.subject.trim(),
        slug,
        excerpt,
        content: input.content,
        sourceUrl: input.sourceUrl || null,
        status: 'DRAFT',
        readsCount: 0,
        seoTitle: input.seoTitle?.trim() || null,
        seoDescription: input.seoDescription?.trim() || null,
        scheduledAt: null,
        publishedAt: null,
        version: 1,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: posts.id })
      .get();

    insertRevision(tx, inserted.id, ctx.actor.id, 'Initial draft');

    writeAudit(tx, {
      actorId: ctx.actor.id,
      action: 'post.created',
      entityType: 'post',
      entityId: inserted.id,
      metadata: { slug, categoryId: input.categoryId },
      requestId: ctx.requestId,
    });

    return inserted.id;
  });

  return getPostForActor(ctx.actor, newId);
}

export interface UpdatePostInput {
  expectedVersion: number;
  categoryId?: number;
  subject?: string;
  slug?: string;
  excerpt?: string;
  content?: string;
  sourceUrl?: string | null;
  featuredImageId?: number | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  changeSummary?: string | null;
}

const EDITABLE_KEYS = [
  'categoryId',
  'subject',
  'slug',
  'excerpt',
  'content',
  'sourceUrl',
  'featuredImageId',
  'seoTitle',
  'seoDescription',
] as const;

/**
 * Version-checked content update.
 *
 * Status, reads, author, publication dates and timestamps are server-owned and
 * are not readable from the payload — see EDITABLE_KEYS.
 */
export function updatePost(ctx: ActorContext, id: number, input: UpdatePostInput): PostDetail {
  const hasEditableField = EDITABLE_KEYS.some((key) => input[key] !== undefined);
  if (!hasEditableField) {
    throw AppError.validation('Provide at least one field to update.');
  }

  assertSourceUrl(input.sourceUrl);
  const db = getDb();

  db.transaction((tx) => {
    const current = getPostRowOrThrow(tx, id);

    if (!canReadPost(ctx.actor.role, ctx.actor.id, current.authorId)) {
      throw AppError.notFound('Post');
    }
    if (!canEditPost(ctx.actor.role, ctx.actor.id, current.authorId, current.status)) {
      throw AppError.forbidden(
        current.authorId === ctx.actor.id
          ? `You can only edit your own posts while they are drafts. This post is ${current.status.replace('_', ' ').toLowerCase()}.`
          : 'You can only edit your own posts.',
      );
    }

    if (input.categoryId !== undefined) assertCategoryUsable(tx, input.categoryId);
    if (input.featuredImageId !== undefined) assertMediaUsable(tx, input.featuredImageId);

    let slug = current.slug;
    if (input.slug !== undefined && normalizeSlug(input.slug) !== current.slug) {
      slug = normalizeSlug(input.slug);
      if (!isValidSlug(slug)) {
        throw AppError.validation(
          'The slug must contain only lowercase letters, numbers and hyphens.',
          {
            slug: ['Use lowercase letters, numbers and hyphens only.'],
          },
        );
      }
      if (slugTaken(tx, slug, id)) {
        throw new AppError('SLUG_EXISTS', 'Another post already uses this slug.');
      }
    }

    const excerpt =
      input.excerpt !== undefined
        ? input.excerpt.trim() || deriveExcerpt(input.content ?? current.content)
        : current.excerpt;

    const result = tx
      .update(posts)
      .set({
        ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
        ...(input.subject !== undefined ? { subject: input.subject.trim() } : {}),
        ...(input.slug !== undefined ? { slug } : {}),
        ...(input.excerpt !== undefined ? { excerpt } : {}),
        ...(input.content !== undefined ? { content: input.content } : {}),
        ...(input.sourceUrl !== undefined ? { sourceUrl: input.sourceUrl || null } : {}),
        ...(input.featuredImageId !== undefined ? { featuredImageId: input.featuredImageId } : {}),
        ...(input.seoTitle !== undefined ? { seoTitle: input.seoTitle?.trim() || null } : {}),
        ...(input.seoDescription !== undefined
          ? { seoDescription: input.seoDescription?.trim() || null }
          : {}),
        version: sql`${posts.version} + 1`,
        updatedAt: nowIso(),
      })
      .where(and(eq(posts.id, id), eq(posts.version, input.expectedVersion)))
      .run();

    if (result.changes === 0) {
      throw versionConflict(current.version, current.updatedAt, input.expectedVersion);
    }

    insertRevision(tx, id, ctx.actor.id, input.changeSummary?.trim() || null);

    writeAudit(tx, {
      actorId: ctx.actor.id,
      action: 'post.updated',
      entityType: 'post',
      entityId: id,
      metadata: {
        fromVersion: input.expectedVersion,
        toVersion: input.expectedVersion + 1,
        fields: EDITABLE_KEYS.filter((key) => input[key] !== undefined),
      },
      requestId: ctx.requestId,
    });
  });

  return getPostForActor(ctx.actor, id);
}

export function versionConflict(
  currentVersion: number,
  updatedAt: string,
  expectedVersion: number,
): AppError {
  return new AppError(
    'VERSION_CONFLICT',
    'This post was changed by another user. Reload before saving.',
    { expectedVersion, currentVersion, updatedAt },
  );
}

/** Soft delete. The slug stays reserved so old links cannot be hijacked. */
export function deletePost(ctx: ActorContext, id: number, expectedVersion: number): void {
  if (!can(ctx.actor.role, 'post.delete')) {
    throw AppError.forbidden('Only administrators and editors can delete posts.');
  }

  const db = getDb();
  db.transaction((tx) => {
    const current = getPostRowOrThrow(tx, id);

    const result = tx
      .update(posts)
      .set({
        deletedAt: nowIso(),
        version: sql`${posts.version} + 1`,
        updatedAt: nowIso(),
      })
      .where(and(eq(posts.id, id), eq(posts.version, expectedVersion)))
      .run();

    if (result.changes === 0) {
      throw versionConflict(current.version, current.updatedAt, expectedVersion);
    }

    writeAudit(tx, {
      actorId: ctx.actor.id,
      action: 'post.deleted',
      entityType: 'post',
      entityId: id,
      metadata: { slug: current.slug, status: current.status },
      requestId: ctx.requestId,
    });
  });
}

/** Workflow history for the post detail screen. */
export interface WorkflowEventDto {
  id: number;
  fromStatus: string | null;
  toStatus: string;
  actorId: number;
  actorName: string;
  comment: string | null;
  createdAt: string;
}

export function listWorkflowEvents(actor: Principal, postId: number): WorkflowEventDto[] {
  // Reuses the read check so an Author cannot inspect another author's history.
  getPostForActor(actor, postId);

  return getDb()
    .select({
      id: workflowEvents.id,
      fromStatus: workflowEvents.fromStatus,
      toStatus: workflowEvents.toStatus,
      actorId: workflowEvents.actorId,
      actorName: users.name,
      comment: workflowEvents.comment,
      createdAt: workflowEvents.createdAt,
    })
    .from(workflowEvents)
    .innerJoin(users, eq(users.id, workflowEvents.actorId))
    .where(eq(workflowEvents.postId, postId))
    .orderBy(desc(workflowEvents.createdAt), desc(workflowEvents.id))
    .all();
}

export interface DashboardActivityDto extends WorkflowEventDto {
  postId: number;
  postSubject: string;
}

/** Recent activity for the dashboard, scoped to what the actor may see. */
export function listRecentWorkflowActivity(actor: Principal, limit = 8): DashboardActivityDto[] {
  const db = getDb();
  const conditions: SQL[] = [isNull(posts.deletedAt)];
  if (!can(actor.role, 'post.readAll')) conditions.push(eq(posts.authorId, actor.id));

  return db
    .select({
      id: workflowEvents.id,
      fromStatus: workflowEvents.fromStatus,
      toStatus: workflowEvents.toStatus,
      actorId: workflowEvents.actorId,
      actorName: users.name,
      comment: workflowEvents.comment,
      createdAt: workflowEvents.createdAt,
      postId: workflowEvents.postId,
      postSubject: posts.subject,
    })
    .from(workflowEvents)
    .innerJoin(posts, eq(posts.id, workflowEvents.postId))
    .innerJoin(users, eq(users.id, workflowEvents.actorId))
    .where(and(...conditions))
    .orderBy(desc(workflowEvents.createdAt), desc(workflowEvents.id))
    .limit(limit)
    .all();
}

/** Bulk-load posts by id without an N+1 (used by the menu resolver). */
export function loadPostsByIds(ids: number[]): Map<
  number,
  {
    id: number;
    slug: string;
    status: PostStatus;
    publishedAt: string | null;
    deletedAt: string | null;
  }
> {
  if (ids.length === 0) return new Map();
  const rows = getDb()
    .select({
      id: posts.id,
      slug: posts.slug,
      status: posts.status,
      publishedAt: posts.publishedAt,
      deletedAt: posts.deletedAt,
    })
    .from(posts)
    .where(inArray(posts.id, ids))
    .all();
  return new Map(rows.map((row) => [row.id, row]));
}
