'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X, Search, ChevronDown } from 'lucide-react';
import type { MenuItemDto } from '@/server/services/menu-service';
import { cn } from '@/lib/utils';

/**
 * Public header navigation.
 *
 * Items arrive already resolved and filtered by the server, so anything with a
 * dead target has been removed before it reaches the browser. This component
 * only decides presentation: active state, hover/focus affordances, and the
 * mobile disclosure.
 */

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** True when the item itself or any child is the current page. */
function branchIsActive(pathname: string, item: MenuItemDto): boolean {
  if (item.resolvedUrl && isActive(pathname, item.resolvedUrl)) return true;
  return item.children.some((child) => child.resolvedUrl && isActive(pathname, child.resolvedUrl));
}

function externalProps(item: MenuItemDto, href: string) {
  return item.openInNewTab && /^https?:\/\//.test(href)
    ? { target: '_blank', rel: 'noopener noreferrer' }
    : {};
}

export function SiteNav({ items }: { items: MenuItemDto[] }) {
  const [open, setOpen] = React.useState(false);
  const pathname = usePathname();
  const close = React.useCallback(() => setOpen(false), []);

  return (
    <>
      {/* ---------------------------------------------------------------- */}
      {/* Desktop                                                          */}
      {/* ---------------------------------------------------------------- */}
      <nav aria-label="Main navigation" className="hidden items-center gap-1 md:flex">
        {items.map((item) => {
          const href = item.resolvedUrl ?? '/';
          const active = branchIsActive(pathname, item);
          const hasChildren = item.children.length > 0;

          return (
            <div key={item.id} className="group relative">
              <Link
                href={href}
                aria-current={
                  item.resolvedUrl && isActive(pathname, item.resolvedUrl) ? 'page' : undefined
                }
                {...externalProps(item, href)}
                className={cn(
                  'focus-visible:ring-brand-600 relative flex h-10 items-center gap-1 rounded-[var(--radius-control)] px-3 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none',
                  active ? 'text-ink-900' : 'text-ink-600 hover:text-ink-900 hover:bg-ink-100',
                )}
              >
                {item.title}
                {hasChildren ? (
                  <ChevronDown aria-hidden="true" className="text-ink-400 h-3.5 w-3.5" />
                ) : null}
                {/* The active marker is an underline rather than a fill, so the
                    header stays quiet while still answering "where am I?". */}
                {active ? (
                  <span
                    aria-hidden="true"
                    className="bg-brand-600 absolute inset-x-3 -bottom-px h-0.5 rounded-full"
                  />
                ) : null}
              </Link>

              {hasChildren ? (
                <div className="invisible absolute top-full left-0 z-30 min-w-56 pt-1 opacity-0 transition-all group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
                  <div className="border-ink-200 shadow-overlay rounded-[var(--radius-surface)] border bg-white p-1.5">
                    {item.children.map((child) => (
                      <Link
                        key={child.id}
                        href={child.resolvedUrl ?? '/'}
                        aria-current={
                          child.resolvedUrl && isActive(pathname, child.resolvedUrl)
                            ? 'page'
                            : undefined
                        }
                        {...externalProps(child, child.resolvedUrl ?? '/')}
                        className={cn(
                          'focus-visible:ring-brand-600 block rounded-[var(--radius-control)] px-3 py-2 text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none',
                          child.resolvedUrl && isActive(pathname, child.resolvedUrl)
                            ? 'bg-brand-50 text-brand-800 font-medium'
                            : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900',
                        )}
                      >
                        {child.title}
                      </Link>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}

        {/* Search is a labelled control, not a bare icon — the label is what
            makes it discoverable. */}
        <Link
          href="/search"
          className="border-ink-200 text-ink-600 hover:border-ink-300 hover:text-ink-900 focus-visible:ring-brand-600 ml-2 flex h-10 items-center gap-2 rounded-[var(--radius-control)] border px-3 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"
        >
          <Search aria-hidden="true" className="h-4 w-4" />
          Search
        </Link>
      </nav>

      {/* ---------------------------------------------------------------- */}
      {/* Mobile                                                           */}
      {/* ---------------------------------------------------------------- */}
      <div className="flex items-center gap-1 md:hidden">
        <Link
          href="/search"
          aria-label="Search"
          className="text-ink-600 hover:bg-ink-100 hover:text-ink-900 focus-visible:ring-brand-600 flex h-11 w-11 items-center justify-center rounded-[var(--radius-control)] transition-colors focus-visible:ring-2 focus-visible:outline-none"
        >
          <Search aria-hidden="true" className="h-5 w-5" />
        </Link>
        <button
          type="button"
          aria-expanded={open}
          aria-controls="mobile-nav"
          aria-label={open ? 'Close menu' : 'Open menu'}
          onClick={() => setOpen((value) => !value)}
          className="text-ink-700 hover:bg-ink-100 focus-visible:ring-brand-600 flex h-11 w-11 items-center justify-center rounded-[var(--radius-control)] transition-colors focus-visible:ring-2 focus-visible:outline-none"
        >
          {open ? (
            <X aria-hidden="true" className="h-5 w-5" />
          ) : (
            <Menu aria-hidden="true" className="h-5 w-5" />
          )}
        </button>
      </div>

      <div
        id="mobile-nav"
        hidden={!open}
        className="border-ink-200 shadow-overlay absolute inset-x-0 top-full max-h-[calc(100dvh-4rem)] overflow-y-auto border-b bg-white md:hidden"
      >
        <nav aria-label="Mobile navigation" className="flex flex-col gap-0.5 p-3">
          {items.map((item) => {
            const href = item.resolvedUrl ?? '/';
            const active = item.resolvedUrl ? isActive(pathname, item.resolvedUrl) : false;

            return (
              <React.Fragment key={item.id}>
                <Link
                  href={href}
                  onClick={close}
                  aria-current={active ? 'page' : undefined}
                  {...externalProps(item, href)}
                  className={cn(
                    // 44px minimum touch target.
                    'flex min-h-11 items-center rounded-[var(--radius-control)] px-3 text-sm font-medium transition-colors',
                    active
                      ? 'bg-brand-50 text-brand-800'
                      : 'text-ink-700 hover:bg-ink-100 hover:text-ink-900',
                  )}
                >
                  {item.title}
                </Link>

                {item.children.map((child) => {
                  const childActive = child.resolvedUrl
                    ? isActive(pathname, child.resolvedUrl)
                    : false;
                  return (
                    <Link
                      key={child.id}
                      href={child.resolvedUrl ?? '/'}
                      onClick={close}
                      aria-current={childActive ? 'page' : undefined}
                      className={cn(
                        'flex min-h-11 items-center rounded-[var(--radius-control)] py-2 pr-3 pl-7 text-sm transition-colors',
                        childActive
                          ? 'bg-brand-50 text-brand-800 font-medium'
                          : 'text-ink-500 hover:bg-ink-100 hover:text-ink-900',
                      )}
                    >
                      {child.title}
                    </Link>
                  );
                })}
              </React.Fragment>
            );
          })}
        </nav>
      </div>
    </>
  );
}
