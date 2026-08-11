import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { FileText, Plus } from 'lucide-react';
import { getCurrentUser } from '@/server/auth/current-user';
import { listPosts } from '@/server/services/post-service';
import { listCategories } from '@/server/services/category-service';
import { listAuthorOptions } from '@/server/services/user-service';
import { getPublicSettings } from '@/server/services/settings-service';
import { can } from '@/lib/permissions';
import { POST_STATUSES, type PostStatus, type PostSortField } from '@/lib/domain';
import { Card, EmptyState } from '@/components/ui/surfaces';
import { Pagination } from '@/components/ui/pagination';
import { PostFilters } from '@/components/admin/post-filters';
import { PostTable } from '@/components/admin/post-table';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Posts' };

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function PostsPage({ searchParams }: PageProps) {
  const user = await getCurrentUser();
  if (!user) redirect('/admin/login');

  const params = await searchParams;
  const status = single(params.status);
  const categoryId = single(params.categoryId);
  const authorId = single(params.authorId);
  const q = single(params.q);
  const sort = single(params.sort);
  const order = single(params.order);
  const page = single(params.page);

  const validStatus = (POST_STATUSES as readonly string[]).includes(status ?? '')
    ? (status as PostStatus)
    : null;

  const { data, meta } = listPosts(user, {
    page,
    status: validStatus,
    categoryId: categoryId ? Number(categoryId) : null,
    authorId: authorId ? Number(authorId) : null,
    q: q ?? null,
    sort,
    order,
  });

  const categories = listCategories();
  const canSeeAllAuthors = can(user.role, 'post.readAll');
  const authors = canSeeAllAuthors ? listAuthorOptions() : [];
  const { timezone } = getPublicSettings();

  // Filters live in the URL so the view can be refreshed, bookmarked and shared.
  const buildHref = (overrides: Record<string, string | undefined>) => {
    const search = new URLSearchParams();
    const current: Record<string, string | undefined> = {
      q,
      status,
      categoryId,
      authorId,
      sort,
      order,
      page,
      ...overrides,
    };
    for (const [key, value] of Object.entries(current)) {
      if (value) search.set(key, value);
    }
    const qs = search.toString();
    return qs ? `/admin/posts?${qs}` : '/admin/posts';
  };

  const hasFilters = Boolean(q || validStatus || categoryId || authorId);

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-ink-900 text-2xl font-bold tracking-tight">Posts</h1>
          <p className="text-ink-500 mt-1 text-sm">
            {canSeeAllAuthors
              ? 'Every post on the site, filterable by status, category and author.'
              : 'The posts you authored. Editors and administrators see everything.'}
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

      <PostFilters
        categories={categories.map((category) => ({ id: category.id, title: category.title }))}
        authors={authors}
        showAuthorFilter={canSeeAllAuthors}
      />

      <Card className="overflow-hidden">
        {data.length === 0 ? (
          <EmptyState
            icon={FileText}
            title={hasFilters ? 'No posts match these filters' : 'No posts yet'}
            description={
              hasFilters
                ? 'Try clearing a filter or searching for something else.'
                : 'Create your first draft to get started.'
            }
            action={
              hasFilters ? (
                <Link
                  href="/admin/posts"
                  className="border-ink-300 text-ink-800 hover:bg-ink-50 inline-flex h-9 items-center rounded-lg border bg-white px-3.5 text-sm font-medium"
                >
                  Clear filters
                </Link>
              ) : (
                <Link
                  href="/admin/posts/new"
                  className="bg-brand-600 hover:bg-brand-700 inline-flex h-9 items-center gap-2 rounded-lg px-3.5 text-sm font-medium text-white"
                >
                  <Plus aria-hidden="true" className="h-4 w-4" />
                  New post
                </Link>
              )
            }
          />
        ) : (
          <>
            <PostTable
              posts={data}
              timezone={timezone}
              currentSort={(sort as PostSortField | undefined) ?? 'updatedAt'}
              currentOrder={order === 'asc' ? 'asc' : 'desc'}
              buildSortHref={(field, nextOrder) =>
                buildHref({ sort: field, order: nextOrder, page: undefined })
              }
            />
            <Pagination
              meta={meta}
              itemLabel="posts"
              buildHref={(target) => buildHref({ page: target === 1 ? undefined : String(target) })}
            />
          </>
        )}
      </Card>
    </div>
  );
}
