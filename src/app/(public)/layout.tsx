import Link from 'next/link';
import { getPublicMenu } from '@/server/services/menu-service';
import { getPublicSettings } from '@/server/services/settings-service';
import { listPublicCategories } from '@/server/services/public-service';
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
  const categories = listPublicCategories();
  const year = new Date().getUTCFullYear();

  return (
    <div className="flex min-h-dvh flex-col bg-white">
      <a href="#main" className="skip-link">
        Skip to content
      </a>

      <header className="border-ink-200 sticky top-0 z-30 border-b bg-white/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-4 sm:px-6">
          <Link
            href="/"
            aria-label={`${settings.siteName} — home`}
            className="focus-visible:ring-brand-600 flex min-w-0 items-center gap-2.5 rounded-[var(--radius-control)] focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            {settings.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={settings.logoUrl}
                alt=""
                className="h-8 w-8 shrink-0 rounded-[var(--radius-control)] object-cover"
              />
            ) : (
              <span
                aria-hidden="true"
                className="bg-ink-900 flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-sm font-bold text-white"
              >
                {settings.siteName.slice(0, 1).toUpperCase()}
              </span>
            )}
            <span className="text-ink-900 truncate text-base font-semibold tracking-tight">
              {settings.siteName}
            </span>
          </Link>

          <SiteNav items={headerItems} />
        </div>
      </header>

      <main id="main" className="flex-1">
        {children}
      </main>

      <footer className="border-ink-200 bg-ink-50 mt-20 border-t">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
            {/* Identity, from site settings — nothing invented. */}
            <div className="lg:col-span-2">
              <div className="flex items-center gap-2.5">
                {settings.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={settings.logoUrl}
                    alt=""
                    className="h-8 w-8 rounded-[var(--radius-control)] object-cover"
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    className="bg-ink-900 flex h-8 w-8 items-center justify-center rounded-[var(--radius-control)] text-sm font-bold text-white"
                  >
                    {settings.siteName.slice(0, 1).toUpperCase()}
                  </span>
                )}
                <p className="text-ink-900 text-base font-semibold">{settings.siteName}</p>
              </div>
              {settings.siteDescription ? (
                <p className="text-ink-600 mt-3 max-w-sm text-sm leading-relaxed">
                  {settings.siteDescription}
                </p>
              ) : null}
            </div>

            {/* Categories double as a site map; they are real CMS data. */}
            {categories.length > 0 ? (
              <nav aria-labelledby="footer-topics">
                <h2
                  id="footer-topics"
                  className="text-ink-900 text-xs font-semibold tracking-wider uppercase"
                >
                  Topics
                </h2>
                <ul className="mt-4 space-y-1">
                  {categories.map((category) => (
                    <li key={category.id}>
                      <Link
                        href={`/categories/${category.slug}`}
                        className="text-ink-600 hover:text-ink-900 focus-visible:ring-brand-600 -mx-2 flex min-h-9 items-center justify-between gap-3 rounded-[var(--radius-control)] px-2 text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
                      >
                        <span>{category.title}</span>
                        <span className="text-ink-400 text-xs tabular-nums">
                          {category.postCount}
                          <span className="sr-only">
                            {' '}
                            {category.postCount === 1 ? 'article' : 'articles'}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            ) : null}

            {footerItems.length > 0 ? (
              <nav aria-labelledby="footer-links">
                <h2
                  id="footer-links"
                  className="text-ink-900 text-xs font-semibold tracking-wider uppercase"
                >
                  More
                </h2>
                <ul className="mt-4 space-y-1">
                  {footerItems.map((item) => {
                    const href = item.resolvedUrl ?? '/';
                    const external = item.openInNewTab && /^https?:\/\//.test(href);
                    return (
                      <li key={item.id}>
                        <Link
                          href={href}
                          {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                          className="text-ink-600 hover:text-ink-900 focus-visible:ring-brand-600 -mx-2 flex min-h-9 items-center rounded-[var(--radius-control)] px-2 text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
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

          <div className="border-ink-200 text-ink-500 mt-12 flex flex-col gap-3 border-t pt-6 text-xs sm:flex-row sm:items-center sm:justify-between">
            <p>
              © {year} {settings.siteName}. Built with PublishFlow CMS.
            </p>
            <Link
              href="/admin"
              className="hover:text-ink-800 focus-visible:ring-brand-600 inline-flex min-h-9 items-center rounded-[var(--radius-control)] underline-offset-4 transition-colors hover:underline focus-visible:ring-2 focus-visible:outline-none"
            >
              Staff sign in
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
