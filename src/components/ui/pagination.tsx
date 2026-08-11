import * as React from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { PaginationMeta } from '@/lib/domain';
import { cn } from '@/lib/utils';

/**
 * Pagination.
 *
 * Rendered as real links so pages can be opened in a new tab, bookmarked and
 * crawled. The current page is marked with `aria-current`.
 *
 * Deliberately a Server Component: it has no state or handlers, and marking it
 * `'use client'` would make the `buildHref` callback an unserialisable prop when
 * a Server Component renders it.
 */

export interface PaginationProps {
  meta: PaginationMeta;
  /** Build the href for a page number (usually preserving other filters). */
  buildHref: (page: number) => string;
  className?: string;
  itemLabel?: string;
}

function pageWindow(current: number, total: number): Array<number | 'gap'> {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);

  const pages = new Set<number>([1, total, current]);
  if (current - 1 > 1) pages.add(current - 1);
  if (current + 1 < total) pages.add(current + 1);

  const sorted = [...pages].sort((a, b) => a - b);
  const output: Array<number | 'gap'> = [];
  let previous = 0;

  for (const page of sorted) {
    if (previous && page - previous > 1) output.push('gap');
    output.push(page);
    previous = page;
  }
  return output;
}

export function Pagination({ meta, buildHref, className, itemLabel = 'items' }: PaginationProps) {
  if (meta.totalPages <= 1) {
    return meta.total > 0 ? (
      <p className={cn('text-ink-500 px-5 py-3 text-xs', className)}>
        {meta.total} {itemLabel}
      </p>
    ) : null;
  }

  const pages = pageWindow(meta.page, meta.totalPages);
  const hasPrevious = meta.page > 1;
  const hasNext = meta.page < meta.totalPages;

  return (
    <nav
      aria-label="Pagination"
      className={cn(
        'border-ink-200 flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3',
        className,
      )}
    >
      <p className="text-ink-500 text-xs">
        Page <span className="text-ink-700 font-medium">{meta.page}</span> of {meta.totalPages} ·{' '}
        {meta.total} {itemLabel}
      </p>

      <ul className="flex items-center gap-1">
        <li>
          {hasPrevious ? (
            <Link
              href={buildHref(meta.page - 1)}
              rel="prev"
              aria-label="Previous page"
              className="border-ink-300 text-ink-700 hover:bg-ink-50 inline-flex h-8 items-center gap-1 rounded-md border bg-white px-2.5 text-sm"
            >
              <ChevronLeft aria-hidden="true" className="h-4 w-4" />
              <span className="hidden sm:inline">Previous</span>
            </Link>
          ) : (
            <span className="border-ink-200 text-ink-400 inline-flex h-8 cursor-not-allowed items-center gap-1 rounded-md border px-2.5 text-sm">
              <ChevronLeft aria-hidden="true" className="h-4 w-4" />
              <span className="hidden sm:inline">Previous</span>
            </span>
          )}
        </li>

        {pages.map((page, index) =>
          page === 'gap' ? (
            <li key={`gap-${index}`} className="text-ink-400 px-1 text-sm" aria-hidden="true">
              …
            </li>
          ) : (
            <li key={page}>
              <Link
                href={buildHref(page)}
                aria-label={`Page ${page}`}
                aria-current={page === meta.page ? 'page' : undefined}
                className={cn(
                  'inline-flex h-8 min-w-8 items-center justify-center rounded-md border px-2 text-sm tabular-nums',
                  page === meta.page
                    ? 'border-brand-600 bg-brand-600 font-medium text-white'
                    : 'border-ink-300 text-ink-700 hover:bg-ink-50 bg-white',
                )}
              >
                {page}
              </Link>
            </li>
          ),
        )}

        <li>
          {hasNext ? (
            <Link
              href={buildHref(meta.page + 1)}
              rel="next"
              aria-label="Next page"
              className="border-ink-300 text-ink-700 hover:bg-ink-50 inline-flex h-8 items-center gap-1 rounded-md border bg-white px-2.5 text-sm"
            >
              <span className="hidden sm:inline">Next</span>
              <ChevronRight aria-hidden="true" className="h-4 w-4" />
            </Link>
          ) : (
            <span className="border-ink-200 text-ink-400 inline-flex h-8 cursor-not-allowed items-center gap-1 rounded-md border px-2.5 text-sm">
              <span className="hidden sm:inline">Next</span>
              <ChevronRight aria-hidden="true" className="h-4 w-4" />
            </span>
          )}
        </li>
      </ul>
    </nav>
  );
}
