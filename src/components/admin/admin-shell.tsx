'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  FileText,
  FolderTree,
  ListTree,
  Image as ImageIcon,
  Users,
  Settings,
  ScrollText,
  Menu as MenuIcon,
  X,
  LogOut,
  ChevronDown,
  ExternalLink,
} from 'lucide-react';
import { toast } from 'sonner';
import type { Principal } from '@/lib/domain';
import { can, type Capability } from '@/lib/permissions';
import { RoleBadge } from '@/components/ui/status-badge';
import { Button } from '@/components/ui/button';
import { api, refreshCsrf } from '@/client/api-client';
import { cn } from '@/lib/utils';

/**
 * Responsive admin shell: sidebar, top bar, breadcrumbs, user menu, mobile drawer.
 *
 * Navigation items are filtered by capability purely for usability. Every API
 * route re-checks permission server-side, so hiding a link is not the control.
 */

interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
  capability?: Capability;
  exact?: boolean;
}

const NAV: NavItem[] = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { href: '/admin/posts', label: 'Posts', icon: FileText },
  {
    href: '/admin/categories',
    label: 'Categories',
    icon: FolderTree,
    capability: 'category.manage',
  },
  { href: '/admin/menus', label: 'Menus', icon: ListTree, capability: 'menu.manage' },
  { href: '/admin/media', label: 'Media', icon: ImageIcon },
  { href: '/admin/users', label: 'Users', icon: Users, capability: 'user.manage' },
  { href: '/admin/settings', label: 'Settings', icon: Settings, capability: 'settings.manage' },
  { href: '/admin/audit', label: 'Audit log', icon: ScrollText, capability: 'audit.view' },
];

const SEGMENT_LABELS: Record<string, string> = {
  admin: 'Dashboard',
  posts: 'Posts',
  categories: 'Categories',
  menus: 'Menus',
  media: 'Media',
  users: 'Users',
  settings: 'Settings',
  audit: 'Audit log',
  new: 'New',
  edit: 'Edit',
  revisions: 'Revisions',
};

function isActive(pathname: string, item: NavItem): boolean {
  return item.exact ? pathname === item.href : pathname.startsWith(item.href);
}

function Breadcrumbs({ pathname }: { pathname: string }) {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length <= 1) return null;

  const crumbs = segments.map((segment, index) => ({
    href: `/${segments.slice(0, index + 1).join('/')}`,
    // Numeric segments are record ids; show them as "#12" rather than a bare number.
    label: SEGMENT_LABELS[segment] ?? (/^\d+$/.test(segment) ? `#${segment}` : segment),
    last: index === segments.length - 1,
  }));

  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="text-ink-500 flex items-center gap-1.5 text-sm">
        {crumbs.map((crumb) => (
          <li key={crumb.href} className="flex min-w-0 items-center gap-1.5">
            {crumb.last ? (
              <span aria-current="page" className="text-ink-800 truncate font-medium">
                {crumb.label}
              </span>
            ) : (
              <>
                <Link href={crumb.href} className="hover:text-ink-800 truncate hover:underline">
                  {crumb.label}
                </Link>
                <span aria-hidden="true" className="text-ink-300">
                  /
                </span>
              </>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

function UserMenu({ user }: { user: Principal }) {
  const [open, setOpen] = React.useState(false);
  const [signingOut, setSigningOut] = React.useState(false);
  const router = useRouter();
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const signOut = async () => {
    setSigningOut(true);
    try {
      await api.post('/auth/logout');
      router.replace('/admin/login');
      router.refresh();
    } catch {
      toast.error('Could not sign out. Please try again.');
      setSigningOut(false);
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="hover:bg-ink-100 flex items-center gap-2 rounded-lg px-2 py-1.5 text-left"
      >
        <span
          aria-hidden="true"
          className="bg-brand-100 text-brand-800 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
        >
          {user.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="hidden min-w-0 sm:block">
          <span className="text-ink-900 block truncate text-sm font-medium">{user.name}</span>
          <span className="text-ink-500 block truncate text-xs">{user.email}</span>
        </span>
        <ChevronDown aria-hidden="true" className="text-ink-400 h-4 w-4 shrink-0" />
      </button>

      {open ? (
        <div
          role="menu"
          className="border-ink-200 absolute right-0 z-40 mt-1.5 w-64 rounded-lg border bg-white p-1.5 shadow-lg"
        >
          <div className="border-ink-200 border-b px-2.5 pt-1.5 pb-2.5">
            <p className="text-ink-900 truncate text-sm font-medium">{user.name}</p>
            <p className="text-ink-500 truncate text-xs">{user.email}</p>
            <div className="mt-2">
              <RoleBadge role={user.role} />
            </div>
          </div>

          <Link
            href="/"
            target="_blank"
            role="menuitem"
            className="text-ink-700 hover:bg-ink-100 mt-1 flex items-center gap-2 rounded-md px-2.5 py-2 text-sm"
          >
            <ExternalLink aria-hidden="true" className="h-4 w-4" />
            View public site
          </Link>

          <button
            type="button"
            role="menuitem"
            onClick={signOut}
            disabled={signingOut}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-60"
          >
            <LogOut aria-hidden="true" className="h-4 w-4" />
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function AdminShell({
  user,
  siteName,
  children,
}: {
  user: Principal;
  siteName: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  const items = NAV.filter((item) => !item.capability || can(user.role, item.capability));

  // The drawer closes on the click that navigates, rather than in an effect
  // watching the pathname — same result, without a second render pass.
  const closeDrawer = React.useCallback(() => setDrawerOpen(false), []);

  // Prime the readable CSRF cookie so the first mutation of a session does not
  // have to round-trip through a 403 and a retry. Safe here: this component only
  // renders behind the session gate.
  React.useEffect(() => {
    void refreshCsrf();
  }, []);

  const sidebar = (
    <nav aria-label="Admin sections" className="flex flex-1 flex-col gap-0.5 p-3">
      {items.map((item) => {
        const Icon = item.icon;
        const active = isActive(pathname, item);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={closeDrawer}
            aria-current={active ? 'page' : undefined}
            className={cn(
              // 44px touch target, and a left rail marks the active section so
              // it reads at a glance rather than by colour alone.
              'focus-visible:ring-brand-600 relative flex min-h-11 items-center gap-2.5 rounded-[var(--radius-control)] px-3 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none',
              active
                ? 'bg-brand-50 text-brand-800'
                : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900',
            )}
          >
            {active ? (
              <span
                aria-hidden="true"
                className="bg-brand-600 absolute top-2 bottom-2 -left-3 w-1 rounded-r-full"
              />
            ) : null}
            <Icon
              aria-hidden="true"
              className={cn('h-4.5 w-4.5 shrink-0', active ? 'text-brand-700' : 'text-ink-400')}
            />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="bg-ink-50 min-h-dvh">
      <a href="#admin-main" className="skip-link">
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside className="border-ink-200 fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r bg-white lg:flex">
        <div className="border-ink-200 flex h-16 items-center gap-2.5 border-b px-4">
          <span
            aria-hidden="true"
            className="bg-brand-600 flex h-8 w-8 items-center justify-center rounded-md text-sm font-bold text-white"
          >
            {siteName.slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="text-ink-900 truncate text-sm font-semibold">{siteName}</p>
            <p className="text-ink-500 text-xs">Admin</p>
          </div>
        </div>
        {sidebar}
      </aside>

      {/* Mobile drawer */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="bg-ink-950/40 absolute inset-0"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
          <div className="relative flex h-full w-72 max-w-[85vw] flex-col bg-white shadow-xl">
            <div className="border-ink-200 flex h-16 items-center justify-between border-b px-4">
              <p className="text-ink-900 text-sm font-semibold">{siteName} Admin</p>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close navigation"
              >
                <X aria-hidden="true" className="h-5 w-5" />
              </Button>
            </div>
            {sidebar}
          </div>
        </div>
      ) : null}

      <div className="lg:pl-60">
        <header className="border-ink-200 sticky top-0 z-20 flex h-16 items-center gap-3 border-b bg-white/95 px-4 backdrop-blur sm:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation"
            aria-expanded={drawerOpen}
          >
            <MenuIcon aria-hidden="true" className="h-5 w-5" />
          </Button>

          <div className="min-w-0 flex-1">
            <Breadcrumbs pathname={pathname} />
          </div>

          <UserMenu user={user} />
        </header>

        <main id="admin-main" className="px-4 py-6 sm:px-6 sm:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
