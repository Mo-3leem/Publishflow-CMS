import 'server-only';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { categories, posts, users } from '@/server/db/schema';
import { can } from '@/lib/permissions';
import { POST_STATUSES, type PostStatus, type Principal } from '@/lib/domain';
import { listRecentWorkflowActivity, type DashboardActivityDto } from './post-service';

/**
 * Dashboard metrics.
 *
 * All status counts come from one grouped query rather than one query per card,
 * and Authors see only their own numbers.
 */

export interface DashboardStats {
  counts: Record<PostStatus, number>;
  totalPosts: number;
  totalReads: number;
  scopedToOwnPosts: boolean;
}

export interface RecentPost {
  id: number;
  subject: string;
  slug: string;
  status: PostStatus;
  categoryTitle: string;
  authorName: string;
  version: number;
  readsCount: number;
  updatedAt: string;
}

export interface DashboardData {
  stats: DashboardStats;
  recentPosts: RecentPost[];
  activity: DashboardActivityDto[];
}

function scopeFor(actor: Principal): { conditions: SQL[]; scoped: boolean } {
  const conditions: SQL[] = [isNull(posts.deletedAt)];
  const scoped = !can(actor.role, 'post.readAll');
  if (scoped) conditions.push(eq(posts.authorId, actor.id));
  return { conditions, scoped };
}

export function getDashboardData(actor: Principal): DashboardData {
  const db = getDb();
  const { conditions, scoped } = scopeFor(actor);
  const where = and(...conditions) as SQL;

  const grouped = db
    .select({
      status: posts.status,
      count: sql<number>`count(*)`,
      reads: sql<number>`coalesce(sum(${posts.readsCount}), 0)`,
    })
    .from(posts)
    .where(where)
    .groupBy(posts.status)
    .all();

  const counts = Object.fromEntries(POST_STATUSES.map((status) => [status, 0])) as Record<
    PostStatus,
    number
  >;
  let totalPosts = 0;
  let totalReads = 0;

  for (const row of grouped) {
    counts[row.status] = row.count;
    totalPosts += row.count;
    totalReads += row.reads;
  }

  const recentPosts = db
    .select({
      id: posts.id,
      subject: posts.subject,
      slug: posts.slug,
      status: posts.status,
      categoryTitle: categories.title,
      authorName: users.name,
      version: posts.version,
      readsCount: posts.readsCount,
      updatedAt: posts.updatedAt,
    })
    .from(posts)
    .innerJoin(categories, eq(categories.id, posts.categoryId))
    .innerJoin(users, eq(users.id, posts.authorId))
    .where(where)
    .orderBy(desc(posts.updatedAt), desc(posts.id))
    .limit(6)
    .all();

  return {
    stats: { counts, totalPosts, totalReads, scopedToOwnPosts: scoped },
    recentPosts,
    activity: listRecentWorkflowActivity(actor, 8),
  };
}
