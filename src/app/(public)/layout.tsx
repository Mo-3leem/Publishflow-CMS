import Link from 'next/link';
import { getPublicMenu } from '@/server/services/menu-service';
import { getPublicSettings } from '@/server/services/settings-service';
import { SiteNav } from '@/components/public/site-nav';

/**
 * Public site shell.
 *
 * A Server Component that calls the services directly rather than fetching its
 * own HTTP API — same process, one query round trip, no self-request.
 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  const settings = getPublicSettings();
  const headerItems = getPublicMenu('HEADER');
  const footerItems = getPublicMenu('FOOTER');
  const year = new Date().getUTCFullYear();

  return (
    <div className="flex min-h-dvh flex-col bg-white">
      <a href="#main" className="skip-link">
        Skip to content
      </a>

      <header className="border-ink-200 relative sticky top-0 z-30 border-b bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/" className="flex min-w-0 items-center gap-2.5">
            {settings.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={settings.logoUrl}
                alt=""
                className="h-8 w-8 shrink-0 rounded-md object-cover"
              />
            ) : (
              <span
                aria-hidden="true"
                className="bg-brand-600 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-sm font-bold text-white"
              >
                {settings.siteName.slice(0, 1).toUpperCase()}
              </span>
            )}
            <span className="text-ink-900 truncate text-base font-semibold">
              {settings.siteName}
            </span>
          </Link>

          <SiteNav items={headerItems} />
        </div>
      </header>

      <main id="main" className="flex-1">
        {children}
      </main>

      <footer className="border-ink-200 bg-ink-50 border-t">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
            <div className="max-w-sm">
              <p className="text-ink-900 text-sm font-semibold">{settings.siteName}</p>
              {settings.siteDescription ? (
                <p className="text-ink-500 mt-1 text-sm">{settings.siteDescription}</p>
              ) : null}
            </div>

            {footerItems.length > 0 ? (
              <nav aria-label="Footer navigation">
                <ul className="flex flex-wrap gap-x-6 gap-y-2">
                  {footerItems.map((item) => {
                    const href = item.resolvedUrl ?? '/';
                    const external = item.openInNewTab && /^https?:\/\//.test(href);
                    return (
                      <li key={item.id}>
                        <Link
                          href={href}
                          {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                          className="text-ink-600 hover:text-ink-900 text-sm underline-offset-4 hover:underline"
                        >
                          {item.title}
                          {external ? <span className="sr-only"> (opens in a new tab)</span> : null}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </nav>
            ) : null}
          </div>

          <div className="border-ink-200 text-ink-500 mt-8 flex flex-col gap-2 border-t pt-6 text-xs sm:flex-row sm:items-center sm:justify-between">
            <p>
              © {year} {settings.siteName}. Built with PublishFlow CMS.
            </p>
            <Link href="/admin" className="hover:text-ink-800 underline-offset-4 hover:underline">
              Staff sign in
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
