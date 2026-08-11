'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, X, Inbox } from 'lucide-react';
import { POST_STATUS_LABELS, POST_STATUSES } from '@/lib/domain';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';

/**
 * Admin post filters.
 *
 * The URL is the single source of truth: every control writes to the query
 * string and the server re-reads it, so refreshing or sharing the link
 * reproduces the exact view.
 */
export function PostFilters({
  categories,
  authors,
  showAuthorFilter,
}: {
  categories: Array<{ id: number; title: string }>;
  authors: Array<{ id: number; name: string }>;
  showAuthorFilter: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlQuery = searchParams.get('q') ?? '';

  // The URL is the source of truth. Rather than syncing it into state with an
  // effect, the draft is reset by remounting: `queryKey` changes whenever the
  // URL query does, and React discards the old state.
  const [query, setQuery] = React.useState(urlQuery);
  const [queryKey, setQueryKey] = React.useState(urlQuery);
  if (queryKey !== urlQuery) {
    setQueryKey(urlQuery);
    setQuery(urlQuery);
  }

  const apply = React.useCallback(
    (updates: Record<string, string | undefined>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      // Any filter change resets to page 1; staying on page 7 of a new result
      // set is almost always an empty screen.
      next.delete('page');
      const qs = next.toString();
      router.push(qs ? `/admin/posts?${qs}` : '/admin/posts');
    },
    [router, searchParams],
  );

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    apply({ q: query.trim() || undefined });
  };

  const activeCount = ['q', 'status', 'categoryId', 'authorId'].filter((key) =>
    searchParams.get(key),
  ).length;

  const reviewQueueActive = searchParams.get('status') === 'IN_REVIEW';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={reviewQueueActive ? '/admin/posts' : '/admin/posts?status=IN_REVIEW'}
          className={`inline-flex h-9 items-center gap-2 rounded-lg border px-3.5 text-sm font-medium transition-colors ${
            reviewQueueActive
              ? 'border-amber-300 bg-amber-50 text-amber-900'
              : 'border-ink-300 text-ink-700 hover:bg-ink-50 bg-white'
          }`}
        >
          <Inbox aria-hidden="true" className="h-4 w-4" />
          Review queue
        </Link>

        {activeCount > 0 ? (
          <Link
            href="/admin/posts"
            className="border-ink-300 text-ink-600 hover:bg-ink-50 inline-flex h-9 items-center gap-1.5 rounded-lg border bg-white px-3 text-sm"
          >
            <X aria-hidden="true" className="h-3.5 w-3.5" />
            Clear {activeCount} filter{activeCount === 1 ? '' : 's'}
          </Link>
        ) : null}
      </div>

      <form
        onSubmit={onSubmit}
        className="border-ink-200 grid gap-3 rounded-xl border bg-white p-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        <div className="lg:col-span-2">
          <label htmlFor="filter-q" className="sr-only">
            Search posts
          </label>
          <div className="relative">
            <Search
              aria-hidden="true"
              className="text-ink-400 pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
            />
            <Input
              id="filter-q"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search subject, summary or slug…"
              className="pl-9"
            />
          </div>
        </div>

        <div>
          <label htmlFor="filter-status" className="sr-only">
            Filter by status
          </label>
          <Select
            id="filter-status"
            value={searchParams.get('status') ?? ''}
            onChange={(event) => apply({ status: event.target.value || undefined })}
          >
            <option value="">All statuses</option>
            {POST_STATUSES.map((status) => (
              <option key={status} value={status}>
                {POST_STATUS_LABELS[status]}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <label htmlFor="filter-category" className="sr-only">
            Filter by category
          </label>
          <Select
            id="filter-category"
            value={searchParams.get('categoryId') ?? ''}
            onChange={(event) => apply({ categoryId: event.target.value || undefined })}
          >
            <option value="">All categories</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.title}
              </option>
            ))}
          </Select>
        </div>

        {showAuthorFilter ? (
          <div>
            <label htmlFor="filter-author" className="sr-only">
              Filter by author
            </label>
            <Select
              id="filter-author"
              value={searchParams.get('authorId') ?? ''}
              onChange={(event) => apply({ authorId: event.target.value || undefined })}
            >
              <option value="">All authors</option>
              {authors.map((author) => (
                <option key={author.id} value={author.id}>
                  {author.name}
                </option>
              ))}
            </Select>
          </div>
        ) : null}

        <div className="flex items-end">
          <Button type="submit" variant="outline" className="w-full sm:w-auto">
            <Search aria-hidden="true" className="h-4 w-4" />
            Search
          </Button>
        </div>
      </form>
    </div>
  );
}
