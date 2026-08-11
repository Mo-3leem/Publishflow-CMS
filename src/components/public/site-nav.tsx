'use client';

import * as React from 'react';
import Link from 'next/link';
import { Menu, X, Search } from 'lucide-react';
import type { MenuItemDto } from '@/server/services/menu-service';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Public header navigation.
 *
 * Items arrive already resolved and filtered by the server, so anything with a
 * dead target has been removed before it reaches the browser.
 */

function NavLink({ item, onNavigate }: { item: MenuItemDto; onNavigate?: () => void }) {
  const href = item.resolvedUrl ?? '/';
  const external = item.openInNewTab && /^https?:\/\//.test(href);

  return (
    <Link
      href={href}
      onClick={onNavigate}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className="text-ink-600 hover:bg-ink-100 hover:text-ink-900 rounded-md px-3 py-2 text-sm font-medium transition-colors"
    >
      {item.title}
      {external ? <span className="sr-only"> (opens in a new tab)</span> : null}
    </Link>
  );
}

export function SiteNav({ items }: { items: MenuItemDto[] }) {
  const [open, setOpen] = React.useState(false);
  const close = React.useCallback(() => setOpen(false), []);

  return (
    <>
      <nav aria-label="Main navigation" className="hidden items-center gap-0.5 md:flex">
        {items.map((item) => (
          <div key={item.id} className="group relative">
            <NavLink item={item} />
            {item.children.length > 0 ? (
              <div className="border-ink-200 invisible absolute top-full left-0 z-20 min-w-48 rounded-lg border bg-white p-1 opacity-0 shadow-lg transition-all group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
                {item.children.map((child) => (
                  <Link
                    key={child.id}
                    href={child.resolvedUrl ?? '/'}
                    className="text-ink-600 hover:bg-ink-100 hover:text-ink-900 block rounded-md px-3 py-2 text-sm"
                  >
                    {child.title}
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
        ))}
        <Link
          href="/search"
          aria-label="Search"
          className="text-ink-600 hover:bg-ink-100 hover:text-ink-900 ml-1 rounded-md p-2 transition-colors"
        >
          <Search aria-hidden="true" className="h-4 w-4" />
        </Link>
      </nav>

      <div className="flex items-center gap-1 md:hidden">
        <Link
          href="/search"
          aria-label="Search"
          className="text-ink-600 hover:bg-ink-100 rounded-md p-2"
        >
          <Search aria-hidden="true" className="h-5 w-5" />
        </Link>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-expanded={open}
          aria-controls="mobile-nav"
          aria-label={open ? 'Close menu' : 'Open menu'}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? (
            <X aria-hidden="true" className="h-5 w-5" />
          ) : (
            <Menu aria-hidden="true" className="h-5 w-5" />
          )}
        </Button>
      </div>

      <div
        id="mobile-nav"
        hidden={!open}
        className={cn(
          'border-ink-200 absolute inset-x-0 top-full border-b bg-white shadow-lg md:hidden',
        )}
      >
        <nav aria-label="Mobile navigation" className="flex flex-col p-2">
          {items.map((item) => (
            <React.Fragment key={item.id}>
              <NavLink item={item} onNavigate={close} />
              {item.children.map((child) => (
                <Link
                  key={child.id}
                  href={child.resolvedUrl ?? '/'}
                  onClick={close}
                  className="text-ink-500 hover:bg-ink-100 hover:text-ink-900 rounded-md py-2 pr-3 pl-7 text-sm"
                >
                  {child.title}
                </Link>
              ))}
            </React.Fragment>
          ))}
        </nav>
      </div>
    </>
  );
}
