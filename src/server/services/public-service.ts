import 'server-only';
import { and, desc, eq, isNull, ne, sql, lte } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { categories, mediaAssets, posts, users } from '@/server/db/schema';
import { nowIso } from '@/lib/datetime';
import { buildMeta, parsePagination } from '@/lib/pagination';
import type { PaginationMeta } from '@/lib/domain';

/**
 * Public read model.
 *
 * `publicVisibility()` is the single predicate every public query composes with.
 * Centralising it is what stops a future query from accidentally leaking a draft:
 * there is one definition of "publicly visible", not one per endpoint.
 */

export interface PublicPostSummary {
  id: number;
  subject: string;
  slug: string;
  excerpt: string;
  categoryTitle: string;
  categorySlug: string;
  authorName: string;
  readsCount: number;
  publishedAt: string | null;
  featuredImageId: number | null;
  featuredImageAlt: string | null;
}

export interface PublicPostDetail extends PublicPostSummary {
  content: string;
  sourceUrl: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  updatedAt: string;
}

/**
 * A post is public only when it is PUBLISHED, its publication moment has passed,
 * it is not soft-deleted, and its category is active.
 */
export function publicVisibility(now: string = nowIso()): SQL {
  const predicate = and(
    eq(posts.status, 'PUBLISHED'),
    isNull(posts.deletedAt),
    sql`${posts.publishedAt} IS NOT NULL`,
    lte(posts.publishedAt, now),
    eq(categories.isActive, 1),
  );
  // `and()` with fixed non-undefined arguments always produces a SQL node.
  return predicate as SQL;
}

const SUMMARY_COLUMNS = {
  id: posts.id,
  subject: posts.subject,
  slug: posts.slug,
  excerpt: posts.excerpt,
  categoryTitle: categories.title,
  categorySlug: categories.slug,
  authorName: users.name,
  readsCount: posts.readsCount,
  publishedAt: posts.publishedAt,
  featuredImageId: posts.featuredImageId,
  featuredImageAlt: mediaAssets.altText,
} as const;

function publicBase() {
  return getDb()
    .select(SUMMARY_COLUMNS)
    .from(posts)
    .innerJoin(categories, eq(categories.id, posts.categoryId))
    .innerJoin(users, eq(users.id, posts.authorId))
    .leftJoin(mediaAssets, eq(mediaAssets.id, posts.featuredImageId));
}

function countPublic(where: SQL): number {
  return (
    getDb()
      .select({ count: sql<number>`count(*)` })
      .from(posts)
      .innerJoin(categories, eq(categories.id, posts.categoryId))
      .where(where)
      .get()?.count ?? 0
  );
}

export interface PublicListQuery {
  page?: unknown;
  pageSize?: unknown;
  categorySlug?: string | null;
}

export function listPublishedPosts(
  query: PublicListQuery,
  defaultPageSize: number,
): { data: PublicPostSummary[]; meta: PaginationMeta } {
  const now = nowIso();
  const { page, pageSize, offset } = parsePagination(query.page, query.pageSize, defaultPageSize);

  const conditions: SQL[] = [publicVisibility(now)];
  if (query.categorySlug) conditions.push(eq(categories.slug, query.categorySlug));
  const where = and(...conditions) as SQL;

  const total = countPublic(where);
  const data = publicBase()
    .where(where)
    .orderBy(desc(posts.publishedAt), desc(posts.id))
    .limit(pageSize)
    .offset(offset)
    .all();

  return { data, meta: buildMeta(page, pageSize, total) };
}

export function getPublishedPostBySlug(slug: string): PublicPostDetail | null {
  const now = nowIso();
  const row = getDb()
    .select({
      ...SUMMARY_COLUMNS,
      content: posts.content,
      sourceUrl: posts.sourceUrl,
      seoTitle: posts.seoTitle,
      seoDescription: posts.seoDescription,
      updatedAt: posts.updatedAt,
    })
    .from(posts)
    .innerJoin(categories, eq(categories.id, posts.categoryId))
    .innerJoin(users, eq(users.id, posts.authorId))
    .leftJoin(mediaAssets, eq(mediaAssets.id, posts.featuredImageId))
    .where(and(eq(posts.slug, slug), publicVisibility(now)))
    .get();

  return row ?? null;
}

/** Sibling posts in the same category, for "read next" without an N+1. */
export function getRelatedPosts(
  postId: number,
  categorySlug: string,
  limit = 3,
): PublicPostSummary[] {
  return publicBase()
    .where(and(publicVisibility(), eq(categories.slug, categorySlug), ne(posts.id, postId)))
    .orderBy(desc(posts.publishedAt), desc(posts.id))
    .limit(limit)
    .all();
}

export interface PublicCategory {
  id: number;
  title: string;
  slug: string;
  description: string;
  postCount: number;
}

/**
 * Active categories with a count of currently visible posts.
 *
 * Two queries rather than a correlated subquery: drizzle omits table
 * qualification when a select has no joins, which would render `categories.id`
 * as a bare `"id"` inside the subquery — and SQLite silently degrades an
 * unresolvable double-quoted identifier to a string literal, making the
 * comparison always false instead of raising an error.
 */
export function listPublicCategories(): PublicCategory[] {
  const db = getDb();
  const now = nowIso();

  const rows = db
    .select({
      id: categories.id,
      title: categories.title,
      slug: categories.slug,
      description: categories.description,
    })
    .from(categories)
    .where(eq(categories.isActive, 1))
    .orderBy(categories.title)
    .all();

  const counts = new Map<number, number>();
  for (const row of db
    .select({ categoryId: posts.categoryId, count: sql<number>`count(*)` })
    .from(posts)
    .innerJoin(categories, eq(categories.id, posts.categoryId))
    .where(publicVisibility(now))
    .groupBy(posts.categoryId)
    .all()) {
    counts.set(row.categoryId, row.count);
  }

  return rows.map((row) => ({ ...row, postCount: counts.get(row.id) ?? 0 }));
}

/** Slugs for sitemap.xml. */
export function listSitemapEntries(): {
  posts: Array<{ slug: string; updatedAt: string; publishedAt: string | null }>;
  categories: Array<{ slug: string; updatedAt: string }>;
} {
  const now = nowIso();
  return {
    posts: getDb()
      .select({ slug: posts.slug, updatedAt: posts.updatedAt, publishedAt: posts.publishedAt })
      .from(posts)
      .innerJoin(categories, eq(categories.id, posts.categoryId))
      .where(publicVisibility(now))
      .orderBy(desc(posts.publishedAt))
      .all(),
    categories: getDb()
      .select({ slug: categories.slug, updatedAt: categories.updatedAt })
      .from(categories)
      .where(eq(categories.isActive, 1))
      .all(),
  };
}
