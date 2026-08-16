import Link from 'next/link';
import { ArrowDown, ArrowUp, ArrowUpDown, History, Pencil, ExternalLink } from 'lucide-react';
import type { PostListItem } from '@/server/services/post-service';
import type { PostSortField, SortOrder } from '@/lib/domain';
import { PostStatusBadge } from '@/components/ui/status-badge';
import { formatInTimezone } from '@/lib/datetime';
import { formatNumber } from '@/lib/utils';

/**
 * Admin post list.
 *
 * Two presentations of the same data rather than one squeezed table:
 *  - below `xl`, a stacked card per post, because a nine-column table forced the
 *    reader to scroll sideways just to reach the row actions;
 *  - at `xl` and above, the full sortable table.
 *
 * The switch is at `xl`, not `lg`: the admin sidebar takes ~290px, so at 1024px
 * the table had only ~719px in which to render 1266px of columns.
 *
 * Both are rendered from the same array and share the same links, so there is
 * no behavioural difference between breakpoints — only layout.
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

function RowActions({ post }: { post: PostListItem }) {
  return (
    <>
      <Link
        href={`/admin/posts/${post.id}/edit`}
        aria-label={`Edit ${post.subject}`}
        title="Edit"
        className="text-ink-500 hover:bg-ink-100 hover:text-ink-900 focus-visible:ring-brand-600 flex h-9 w-9 items-center justify-center rounded-[var(--radius-control)] transition-colors focus-visible:ring-2 focus-visible:outline-none"
      >
        <Pencil aria-hidden="true" className="h-4 w-4" />
      </Link>
      <Link
        href={`/admin/posts/${post.id}/revisions`}
        aria-label={`Revision history for ${post.subject}`}
        title="Revision history"
        className="text-ink-500 hover:bg-ink-100 hover:text-ink-900 focus-visible:ring-brand-600 flex h-9 w-9 items-center justify-center rounded-[var(--radius-control)] transition-colors focus-visible:ring-2 focus-visible:outline-none"
      >
        <History aria-hidden="true" className="h-4 w-4" />
      </Link>
      {post.status === 'PUBLISHED' ? (
        <Link
          href={`/posts/${post.slug}`}
          target="_blank"
          aria-label={`View ${post.subject} on the public site`}
          title="View on the public site"
          className="text-ink-500 hover:bg-ink-100 hover:text-ink-900 focus-visible:ring-brand-600 flex h-9 w-9 items-center justify-center rounded-[var(--radius-control)] transition-colors focus-visible:ring-2 focus-visible:outline-none"
        >
          <ExternalLink aria-hidden="true" className="h-4 w-4" />
        </Link>
      ) : null}
    </>
  );
}

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
    <>
      {/* ---------------------------------------------------------------- */}
      {/* Stacked cards — below xl                                          */}
      {/* ---------------------------------------------------------------- */}
      <ul className="divide-ink-200 divide-y xl:hidden">
        {posts.map((post) => (
          <li key={post.id} className="hover:bg-ink-50/60 p-4 transition-colors">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <Link
                  href={`/admin/posts/${post.id}/edit`}
                  className="text-ink-900 hover:text-brand-700 focus-visible:ring-brand-600 block rounded-[var(--radius-control)] font-medium focus-visible:ring-2 focus-visible:outline-none"
                >
                  {post.subject}
                </Link>
                <p className="text-ink-400 mt-0.5 truncate font-mono text-xs">/{post.slug}</p>
              </div>
              <PostStatusBadge status={post.status} />
            </div>

            {/* Labelled pairs, so no column meaning is lost when the table
                header disappears. */}
            <dl className="text-ink-600 mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3 lg:grid-cols-5">
              <div className="flex gap-1.5">
                <dt className="text-ink-400">Category</dt>
                <dd className="truncate font-medium">{post.categoryTitle}</dd>
              </div>
              <div className="flex gap-1.5">
                <dt className="text-ink-400">Author</dt>
                <dd className="truncate font-medium">{post.authorName}</dd>
              </div>
              <div className="flex gap-1.5">
                <dt className="text-ink-400">Reads</dt>
                <dd className="font-medium tabular-nums">{formatNumber(post.readsCount)}</dd>
              </div>
              <div className="flex gap-1.5">
                <dt className="text-ink-400">Version</dt>
                <dd className="font-medium tabular-nums">v{post.version}</dd>
              </div>
              <div className="col-span-2 flex gap-1.5 sm:col-span-1">
                <dt className="text-ink-400">Updated</dt>
                <dd className="font-medium">{formatInTimezone(post.updatedAt, timezone)}</dd>
              </div>
            </dl>

            <div className="border-ink-100 mt-3 flex items-center gap-1 border-t pt-2">
              <RowActions post={post} />
            </div>
          </li>
        ))}
      </ul>

      {/* ---------------------------------------------------------------- */}
      {/* Table — xl and above                                              */}
      {/* ---------------------------------------------------------------- */}
      <div className="hidden overflow-x-auto xl:block">
        <table className="w-full border-collapse text-sm">
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
                    className={`text-ink-500 px-3 py-2.5 text-xs font-semibold tracking-wide uppercase ${column.className ?? ''}`}
                  >
                    {column.key ? (
                      <Link
                        href={buildSortHref(column.key, nextOrder)}
                        className={`hover:text-ink-900 focus-visible:ring-brand-600 inline-flex items-center gap-1 rounded-[var(--radius-control)] transition-colors focus-visible:ring-2 focus-visible:outline-none ${active ? 'text-ink-900' : ''}`}
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
              <tr key={post.id} className="hover:bg-ink-50/60 transition-colors">
                <th scope="row" className="max-w-[13rem] px-3 py-3 text-left font-normal">
                  <Link
                    href={`/admin/posts/${post.id}/edit`}
                    className="text-ink-900 hover:text-brand-700 focus-visible:ring-brand-600 block truncate rounded-[var(--radius-control)] font-medium focus-visible:ring-2 focus-visible:outline-none"
                    title={post.subject}
                  >
                    {post.subject}
                  </Link>
                  <span className="text-ink-400 block truncate font-mono text-xs">
                    /{post.slug}
                  </span>
                </th>

                <td className="px-3 py-3">
                  <PostStatusBadge status={post.status} />
                </td>

                <td className="text-ink-600 px-3 py-3">{post.categoryTitle}</td>
                <td className="text-ink-600 px-3 py-3">{post.authorName}</td>
                <td className="text-ink-600 px-3 py-3 text-right tabular-nums">
                  {formatNumber(post.readsCount)}
                </td>
                <td className="text-ink-500 px-3 py-3 text-right tabular-nums">v{post.version}</td>
                <td className="text-ink-600 px-3 py-3 whitespace-nowrap">
                  {formatInTimezone(post.updatedAt, timezone)}
                </td>
                <td className="text-ink-600 px-3 py-3 whitespace-nowrap">
                  {post.publishedAt ? formatInTimezone(post.publishedAt, timezone) : '—'}
                </td>

                <td className="px-3 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <RowActions post={post} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
