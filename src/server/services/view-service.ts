import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import { getDb, getSqlite } from '@/server/db';
import { posts, postViews } from '@/server/db/schema';
import { getEnv } from '@/server/env';
import { hmac } from '@/server/auth/tokens';
import { nowIso, utcDateKey } from '@/lib/datetime';
import { AppError } from '@/server/errors/app-error';

/**
 * De-duplicated read counting.
 *
 * The visitor cookie is an opaque random value; only its HMAC is stored, and no
 * IP address is recorded. `(post, viewerHash, utcDay)` is the primary key, so a
 * refresh loop cannot inflate the counter and the endpoint is idempotent.
 */

export function viewerHashFor(visitorId: string): string {
  return hmac(getEnv().VIEWER_HASH_SECRET, visitorId);
}

export interface ViewResult {
  counted: boolean;
  readsCount: number;
}

export function recordPostView(slug: string, visitorId: string, at: Date = new Date()): ViewResult {
  const db = getDb();
  const now = nowIso();

  const post = db
    .select({ id: posts.id, readsCount: posts.readsCount })
    .from(posts)
    .where(
      and(
        eq(posts.slug, slug),
        eq(posts.status, 'PUBLISHED'),
        sql`${posts.deletedAt} IS NULL`,
        sql`${posts.publishedAt} IS NOT NULL AND ${posts.publishedAt} <= ${now}`,
      ),
    )
    .get();

  if (!post) throw AppError.notFound('Post');

  const viewerHash = viewerHashFor(visitorId);
  const viewedOn = utcDateKey(at);
  const sqlite = getSqlite();

  // BEGIN IMMEDIATE: take the write lock up front so the insert and the
  // increment cannot interleave with another writer between the two statements.
  const run = sqlite.transaction((): ViewResult => {
    const insert = sqlite
      .prepare(
        `INSERT OR IGNORE INTO post_views (post_id, viewer_hash, viewed_on, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(post.id, viewerHash, viewedOn, now);

    if (insert.changes === 0) {
      const current = sqlite
        .prepare('SELECT reads_count AS readsCount FROM posts WHERE id = ?')
        .get(post.id) as { readsCount: number } | undefined;
      return { counted: false, readsCount: current?.readsCount ?? post.readsCount };
    }

    // Atomic SQL increment — never read-modify-write in application memory.
    sqlite.prepare('UPDATE posts SET reads_count = reads_count + 1 WHERE id = ?').run(post.id);

    const updated = sqlite
      .prepare('SELECT reads_count AS readsCount FROM posts WHERE id = ?')
      .get(post.id) as { readsCount: number } | undefined;

    return { counted: true, readsCount: updated?.readsCount ?? post.readsCount + 1 };
  });

  return run.immediate();
}

/** Total reads across all non-deleted posts, for the dashboard. */
export function totalReads(): number {
  return (
    getDb()
      .select({ total: sql<number>`coalesce(sum(${posts.readsCount}), 0)` })
      .from(posts)
      .where(sql`${posts.deletedAt} IS NULL`)
      .get()?.total ?? 0
  );
}

export function countViewRows(postId: number): number {
  return (
    getDb()
      .select({ count: sql<number>`count(*)` })
      .from(postViews)
      .where(eq(postViews.postId, postId))
      .get()?.count ?? 0
  );
}
