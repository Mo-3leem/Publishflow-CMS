import type { Metadata } from 'next';
import Link from 'next/link';
import { CircleDashed, Eye, Clock3, CheckCircle2, BookOpen, Plus, ArrowRight } from 'lucide-react';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/server/auth/current-user';
import { getDashboardData } from '@/server/services/dashboard-service';
import { getPublicSettings } from '@/server/services/settings-service';
import { Card, CardHeader, EmptyState } from '@/components/ui/surfaces';
import { PostStatusBadge } from '@/components/ui/status-badge';
import { formatInTimezone, relativeTime } from '@/lib/datetime';
import { formatNumber } from '@/lib/utils';
import { POST_STATUS_LABELS, type PostStatus } from '@/lib/domain';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Dashboard' };

const CARDS: Array<{
  status: PostStatus | 'READS';
  label: string;
  icon: React.ElementType;
  tone: string;
  href?: string;
}> = [
  {
    status: 'DRAFT',
    label: 'Drafts',
    icon: CircleDashed,
    tone: 'bg-ink-100 text-ink-700',
    href: '/admin/posts?status=DRAFT',
  },
  {
    status: 'IN_REVIEW',
    label: 'Waiting for review',
    icon: Eye,
    tone: 'bg-amber-100 text-amber-800',
    href: '/admin/posts?status=IN_REVIEW',
  },
  {
    status: 'SCHEDULED',
    label: 'Scheduled',
    icon: Clock3,
    tone: 'bg-violet-100 text-violet-800',
    href: '/admin/posts?status=SCHEDULED',
  },
  {
    status: 'PUBLISHED',
    label: 'Published',
    icon: CheckCircle2,
    tone: 'bg-emerald-100 text-emerald-800',
    href: '/admin/posts?status=PUBLISHED',
  },
  { status: 'READS', label: 'Total reads', icon: BookOpen, tone: 'bg-brand-100 text-brand-800' },
];

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/admin/login');

  const { stats, recentPosts, activity } = getDashboardData(user);
  const { timezone } = getPublicSettings();

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-ink-900 text-2xl font-bold tracking-tight">
            Welcome back, {user.name.split(' ')[0]}
          </h1>
          <p className="text-ink-500 mt-1 text-sm">
            {stats.scopedToOwnPosts
              ? 'These figures cover the posts you authored.'
              : 'These figures cover every post on the site.'}
          </p>
        </div>
        <Link
          href="/admin/posts/new"
          className="bg-brand-600 hover:bg-brand-700 inline-flex h-10 shrink-0 items-center gap-2 rounded-lg px-4 text-sm font-medium text-white shadow-sm"
        >
          <Plus aria-hidden="true" className="h-4 w-4" />
          New post
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {CARDS.map((card) => {
          const Icon = card.icon;
          const value = card.status === 'READS' ? stats.totalReads : stats.counts[card.status];
          const body = (
            <>
              <div className="flex items-center justify-between gap-3">
                <span
                  aria-hidden="true"
                  className={`flex h-9 w-9 items-center justify-center rounded-lg ${card.tone}`}
                >
                  <Icon className="h-4.5 w-4.5" />
                </span>
                {card.href ? (
                  <ArrowRight aria-hidden="true" className="text-ink-300 h-4 w-4" />
                ) : null}
              </div>
              <p className="text-ink-900 mt-3 text-3xl font-bold tracking-tight tabular-nums">
                {formatNumber(value)}
              </p>
              <p className="text-ink-600 text-sm font-medium">{card.label}</p>
              {/* The review queue is the only card that implies work to do, so
                  it says so once there is something in it. */}
              {card.status === 'IN_REVIEW' && value > 0 ? (
                <p className="mt-1 text-xs font-medium text-amber-700">Needs your attention</p>
              ) : null}
            </>
          );

          return card.href ? (
            <Link
              key={card.label}
              href={card.href}
              className="border-ink-200 hover:border-brand-300 hover:bg-brand-50/40 rounded-xl border bg-white p-4 shadow-sm transition-colors"
            >
              {body}
            </Link>
          ) : (
            <div
              key={card.label}
              className="border-ink-200 shadow-raised rounded-[var(--radius-surface)] border bg-white p-4"
            >
              {body}
            </div>
          );
        })}
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader
            title="Recently edited"
            description="The posts you touched most recently."
            action={
              <Link
                href="/admin/posts"
                className="text-brand-700 text-sm font-medium underline-offset-4 hover:underline"
              >
                All posts
              </Link>
            }
          />

          {recentPosts.length === 0 ? (
            <EmptyState
              title="No posts yet"
              description="Create your first draft to get started."
              action={
                <Link
                  href="/admin/posts/new"
                  className="bg-brand-600 hover:bg-brand-700 inline-flex h-9 items-center gap-2 rounded-lg px-3.5 text-sm font-medium text-white"
                >
                  <Plus aria-hidden="true" className="h-4 w-4" />
                  New post
                </Link>
              }
            />
          ) : (
            <ul className="divide-ink-200 divide-y">
              {recentPosts.map((post) => (
                <li key={post.id} className="px-5 py-3.5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/admin/posts/${post.id}/edit`}
                        className="text-ink-900 hover:text-brand-700 block truncate font-medium"
                      >
                        {post.subject}
                      </Link>
                      <p className="text-ink-500 mt-0.5 truncate text-xs">
                        {post.categoryTitle} · {post.authorName} · v{post.version} · updated{' '}
                        {relativeTime(post.updatedAt)}
                      </p>
                    </div>
                    <PostStatusBadge status={post.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Recent activity" description="Workflow transitions." />

          {activity.length === 0 ? (
            <EmptyState
              title="Nothing has happened yet"
              description="Submissions, publications and archives appear here."
            />
          ) : (
            <ul className="divide-ink-200 divide-y">
              {activity.map((event) => (
                <li key={event.id} className="px-5 py-3.5">
                  <p className="text-ink-800 text-sm">
                    <span className="font-medium">{event.actorName}</span>{' '}
                    <span className="text-ink-500">
                      moved{' '}
                      {event.fromStatus
                        ? POST_STATUS_LABELS[event.fromStatus as PostStatus]?.toLowerCase()
                        : 'a post'}{' '}
                      →{' '}
                    </span>
                    <span className="font-medium">
                      {POST_STATUS_LABELS[event.toStatus as PostStatus] ?? event.toStatus}
                    </span>
                  </p>
                  <Link
                    href={`/admin/posts/${event.postId}/edit`}
                    className="text-brand-700 mt-0.5 block truncate text-xs hover:underline"
                  >
                    {event.postSubject}
                  </Link>
                  {event.comment ? (
                    <p className="bg-ink-50 text-ink-600 mt-1 rounded-md px-2 py-1.5 text-xs">
                      “{event.comment}”
                    </p>
                  ) : null}
                  <p className="text-ink-400 mt-1 text-xs">
                    {formatInTimezone(event.createdAt, timezone)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
