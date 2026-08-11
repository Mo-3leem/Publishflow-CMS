import Link from 'next/link';
import { ArrowDown, ArrowUp, ArrowUpDown, History, Pencil, ExternalLink } from 'lucide-react';
import type { PostListItem } from '@/server/services/post-service';
import type { PostSortField, SortOrder } from '@/lib/domain';
import { PostStatusBadge } from '@/components/ui/status-badge';
import { formatInTimezone } from '@/lib/datetime';
import { formatNumber } from '@/lib/utils';

/**
 * Admin post table.
 *
 * A real `<table>` with proper scope attributes; on narrow screens it scrolls
 * horizontally inside its own container instead of breaking the page layout.
 */

interface Column {
  key: PostSortField | null;
  label: string;
  className?: string;
}

const COLUMNS: Column[] = [
  { key: 'subject', label: 'Subject' },
  { key: 'status', label: 'Status' },
  { key: null, label: 'Category' },
  { key: null, label: 'Author' },
  { key: 'readsCount', label: 'Reads', className: 'text-right' },
  { key: null, label: 'Version', className: 'text-right' },
  { key: 'updatedAt', label: 'Updated' },
  { key: 'publishedAt', label: 'Published' },
  { key: null, label: 'Actions', className: 'text-right' },
];

export function PostTable({
  posts,
  timezone,
  currentSort,
  currentOrder,
  buildSortHref,
}: {
  posts: PostListItem[];
  timezone: string;
  currentSort: PostSortField;
  currentOrder: SortOrder;
  buildSortHref: (field: PostSortField, order: SortOrder) => string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[62rem] border-collapse text-sm">
        <thead>
          <tr className="border-ink-200 bg-ink-50 border-b text-left">
            {COLUMNS.map((column) => {
              const active = column.key !== null && column.key === currentSort;
              const nextOrder: SortOrder = active && currentOrder === 'desc' ? 'asc' : 'desc';
              const Icon = !active ? ArrowUpDown : currentOrder === 'asc' ? ArrowUp : ArrowDown;

              return (
                <th
                  key={column.label}
                  scope="col"
                  aria-sort={
                    active ? (currentOrder === 'asc' ? 'ascending' : 'descending') : undefined
                  }
                  className={`text-ink-500 px-4 py-2.5 text-xs font-semibold tracking-wide uppercase ${column.className ?? ''}`}
                >
                  {column.key ? (
                    <Link
                      href={buildSortHref(column.key, nextOrder)}
                      className={`hover:text-ink-800 inline-flex items-center gap-1 ${active ? 'text-ink-800' : ''}`}
                    >
                      {column.label}
                      <Icon aria-hidden="true" className="h-3 w-3" />
                      <span className="sr-only">
                        {active
                          ? `sorted ${currentOrder === 'asc' ? 'ascending' : 'descending'}, activate to reverse`
                          : 'activate to sort'}
                      </span>
                    </Link>
                  ) : (
                    column.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>

        <tbody className="divide-ink-200 divide-y">
          {posts.map((post) => (
            <tr key={post.id} className="hover:bg-ink-50/60">
              <th scope="row" className="max-w-xs px-4 py-3 text-left font-normal">
                <Link
                  href={`/admin/posts/${post.id}/edit`}
                  className="text-ink-900 hover:text-brand-700 block truncate font-medium"
                  title={post.subject}
                >
                  {post.subject}
                </Link>
                <span className="text-ink-400 block truncate text-xs">/{post.slug}</span>
              </th>

              <td className="px-4 py-3">
                <PostStatusBadge status={post.status} />
              </td>

              <td className="text-ink-600 px-4 py-3">{post.categoryTitle}</td>
              <td className="text-ink-600 px-4 py-3">{post.authorName}</td>
              <td className="text-ink-600 px-4 py-3 text-right tabular-nums">
                {formatNumber(post.readsCount)}
              </td>
              <td className="text-ink-500 px-4 py-3 text-right tabular-nums">v{post.version}</td>
              <td className="text-ink-600 px-4 py-3 whitespace-nowrap">
                {formatInTimezone(post.updatedAt, timezone)}
              </td>
              <td className="text-ink-600 px-4 py-3 whitespace-nowrap">
                {post.publishedAt ? formatInTimezone(post.publishedAt, timezone) : '—'}
              </td>

              <td className="px-4 py-3">
                <div className="flex items-center justify-end gap-1">
                  <Link
                    href={`/admin/posts/${post.id}/edit`}
                    aria-label={`Edit ${post.subject}`}
                    className="text-ink-500 hover:bg-ink-100 hover:text-ink-800 rounded-md p-1.5"
                  >
                    <Pencil aria-hidden="true" className="h-4 w-4" />
                  </Link>
                  <Link
                    href={`/admin/posts/${post.id}/revisions`}
                    aria-label={`Revision history for ${post.subject}`}
                    className="text-ink-500 hover:bg-ink-100 hover:text-ink-800 rounded-md p-1.5"
                  >
                    <History aria-hidden="true" className="h-4 w-4" />
                  </Link>
                  {post.status === 'PUBLISHED' ? (
                    <Link
                      href={`/posts/${post.slug}`}
                      target="_blank"
                      aria-label={`View ${post.subject} on the public site`}
                      className="text-ink-500 hover:bg-ink-100 hover:text-ink-800 rounded-md p-1.5"
                    >
                      <ExternalLink aria-hidden="true" className="h-4 w-4" />
                    </Link>
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
