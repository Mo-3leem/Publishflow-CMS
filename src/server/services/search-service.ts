import 'server-only';
import { and, desc, eq, like, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { getDb, isFtsAvailable } from '@/server/db';
import { categories, mediaAssets, posts, users } from '@/server/db/schema';
import { buildMeta, parsePagination } from '@/lib/pagination';
import { nowIso } from '@/lib/datetime';
import type { PaginationMeta } from '@/lib/domain';
import { publicVisibility, type PublicPostSummary } from './public-service';

/**
 * Public search.
 *
 * Uses SQLite FTS5 when the bundled build provides it, and falls back to a
 * parameterised LIKE scan otherwise. Both paths apply the same public visibility
 * predicate, so an unpublished post can never surface through either one.
 *
 * Tokenizer: `porter unicode61 remove_diacritics 2` (see drizzle/0001_fts.sql).
 * Ranking uses FTS5 `bm25()` with the subject weighted highest, then excerpt,
 * then body; ties break on publication date so results are deterministic.
 */

export const MAX_QUERY_LENGTH = 120;

export interface SearchResult extends PublicPostSummary {
  rank: number | null;
}

export interface SearchOutcome {
  data: SearchResult[];
  meta: PaginationMeta;
  mode: 'fts' | 'like' | 'empty';
}

/**
 * Convert free text into a safe FTS5 MATCH expression.
 *
 * Every token is quoted so FTS operators typed by a visitor (`NEAR`, `*`, `"`,
 * `-`, column filters) are treated as literal text rather than syntax that could
 * throw or change the query shape.
 */
export function toFtsQuery(raw: string): string | null {
  const tokens = raw
    .slice(0, MAX_QUERY_LENGTH)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 0)
    .slice(0, 12);

  if (tokens.length === 0) return null;
  // Escape embedded double quotes by doubling them, per FTS5 string syntax.
  return tokens.map((token) => `"${token.replace(/"/g, '""')}"*`).join(' AND ');
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

export interface SearchQuery {
  q: string;
  page?: unknown;
  pageSize?: unknown;
  categorySlug?: string | null;
}

export function searchPublishedPosts(query: SearchQuery, defaultPageSize: number): SearchOutcome {
  const trimmed = query.q.trim();
  const { page, pageSize, offset } = parsePagination(query.page, query.pageSize, defaultPageSize);

  if (trimmed.length === 0) {
    return { data: [], meta: buildMeta(page, pageSize, 0), mode: 'empty' };
  }

  const now = nowIso();
  const baseConditions: SQL[] = [publicVisibility(now)];
  if (query.categorySlug) baseConditions.push(eq(categories.slug, query.categorySlug));

  const ftsExpression = isFtsAvailable() ? toFtsQuery(trimmed) : null;

  if (ftsExpression) {
    try {
      return runFtsSearch(ftsExpression, baseConditions, page, pageSize, offset);
    } catch {
      // A malformed expression or a missing index must degrade to LIKE rather
      // than 500 on a visitor-supplied query.
    }
  }

  return runLikeSearch(trimmed, baseConditions, page, pageSize, offset);
}

function runFtsSearch(
  expression: string,
  baseConditions: SQL[],
  page: number,
  pageSize: number,
  offset: number,
): SearchOutcome {
  const db = getDb();
  const matchFilter = sql`${posts.id} IN (SELECT rowid FROM posts_fts WHERE posts_fts MATCH ${expression})`;
  const where = and(...baseConditions, matchFilter) as SQL;

  const total =
    db
      .select({ count: sql<number>`count(*)` })
      .from(posts)
      .innerJoin(categories, eq(categories.id, posts.categoryId))
      .where(where)
      .get()?.count ?? 0;

  const rankExpression = sql<number>`(
    SELECT bm25(posts_fts, 10.0, 4.0, 1.0)
    FROM posts_fts
    WHERE posts_fts MATCH ${expression} AND posts_fts.rowid = ${posts.id}
  )`;

  const data = db
    .select({ ...SUMMARY_COLUMNS, rank: rankExpression })
    .from(posts)
    .innerJoin(categories, eq(categories.id, posts.categoryId))
    .innerJoin(users, eq(users.id, posts.authorId))
    .leftJoin(mediaAssets, eq(mediaAssets.id, posts.featuredImageId))
    .where(where)
    // bm25() returns a negative score where lower is more relevant.
    .orderBy(sql`${rankExpression} ASC`, desc(posts.publishedAt), desc(posts.id))
    .limit(pageSize)
    .offset(offset)
    .all();

  return { data, meta: buildMeta(page, pageSize, total), mode: 'fts' };
}

function runLikeSearch(
  raw: string,
  baseConditions: SQL[],
  page: number,
  pageSize: number,
  offset: number,
): SearchOutcome {
  const db = getDb();
  const needle = `%${raw.slice(0, MAX_QUERY_LENGTH)}%`;
  const textMatch = or(
    like(posts.subject, needle),
    like(posts.excerpt, needle),
    like(posts.slug, needle),
    like(posts.content, needle),
  );
  const where = and(...baseConditions, textMatch) as SQL;

  const total =
    db
      .select({ count: sql<number>`count(*)` })
      .from(posts)
      .innerJoin(categories, eq(categories.id, posts.categoryId))
      .where(where)
      .get()?.count ?? 0;

  const data = db
    .select({ ...SUMMARY_COLUMNS, rank: sql<number | null>`NULL` })
    .from(posts)
    .innerJoin(categories, eq(categories.id, posts.categoryId))
    .innerJoin(users, eq(users.id, posts.authorId))
    .leftJoin(mediaAssets, eq(mediaAssets.id, posts.featuredImageId))
    .where(where)
    .orderBy(desc(posts.publishedAt), desc(posts.id))
    .limit(pageSize)
    .offset(offset)
    .all();

  return { data, meta: buildMeta(page, pageSize, total), mode: 'like' };
}

export function searchMode(): 'fts' | 'like' {
  return isFtsAvailable() ? 'fts' : 'like';
}
