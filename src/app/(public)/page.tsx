import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Newspaper, Search } from 'lucide-react';
import { listPublicCategories, listPublishedPosts } from '@/server/services/public-service';
import { getPublicSettings } from '@/server/services/settings-service';
import { PostCard } from '@/components/public/post-card';
import { EmptyState } from '@/components/ui/surfaces';
import { Pagination } from '@/components/ui/pagination';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  const settings = getPublicSettings();
  return {
    title: settings.defaultSeoTitle ?? settings.siteName,
    description: settings.defaultSeoDescription ?? settings.siteDescription,
    alternates: { canonical: '/' },
    openGraph: {
      type: 'website',
      title: settings.defaultSeoTitle ?? settings.siteName,
      description: settings.defaultSeoDescription ?? settings.siteDescription,
      siteName: settings.siteName,
    },
  };
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const params = await searchParams;
  const settings = getPublicSettings();
  const { data: posts, meta } = listPublishedPosts({ page: params.page }, settings.postsPerPage);
  const categories = listPublicCategories();

  // Only the first page leads with a featured story; deeper pages are a plain
  // chronological grid, which is what a reader paging back expects.
  const isFirstPage = meta.page === 1;
  const [lead, ...rest] = isFirstPage ? posts : [];
  const gridPosts = isFirstPage ? rest : posts;

  return (
    <>
      {/* ------------------------------------------------------------------ */}
      {/* Masthead                                                           */}
      {/* ------------------------------------------------------------------ */}
      <section className="border-ink-200 border-b">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
          <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <h1 className="text-ink-900 text-4xl font-bold tracking-tight text-balance sm:text-5xl">
                {settings.siteName}
              </h1>
              {settings.siteDescription ? (
                <p className="text-ink-600 mt-4 text-lg leading-relaxed text-pretty">
                  {settings.siteDescription}
                </p>
              ) : null}
            </div>

            {/* A real search entry point on the first screen, rather than an
                icon the reader has to go looking for. */}
            <form
              method="GET"
              action="/search"
              role="search"
              className="w-full lg:max-w-xs lg:shrink-0"
            >
              <label htmlFor="home-search" className="text-ink-700 block text-sm font-medium">
                Search articles
              </label>
              <div className="mt-2 flex gap-2">
                <div className="relative flex-1">
                  <Search
                    aria-hidden="true"
                    className="text-ink-400 pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
                  />
                  <input
                    id="home-search"
                    name="q"
                    type="search"
                    placeholder="Try “locking”"
                    maxLength={120}
                    className="border-ink-300 text-ink-900 placeholder:text-ink-400 hover:border-ink-400 focus-visible:border-brand-500 focus-visible:ring-brand-500/40 shadow-raised h-11 w-full rounded-[var(--radius-control)] border bg-white pr-3 pl-9 text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
                  />
                </div>
                <button
                  type="submit"
                  className="bg-ink-900 hover:bg-ink-800 focus-visible:ring-brand-600 shadow-raised h-11 shrink-0 rounded-[var(--radius-control)] px-4 text-sm font-medium text-white transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
                >
                  Search
                </button>
              </div>
            </form>
          </div>

          {categories.length > 0 ? (
            <nav aria-label="Browse by topic" className="mt-10">
              <h2 className="text-ink-500 text-xs font-semibold tracking-wider uppercase">
                Browse by topic
              </h2>
              <ul className="mt-3 flex flex-wrap gap-2">
                {categories.map((category) => (
                  <li key={category.id}>
                    <Link
                      href={`/categories/${category.slug}`}
                      className="border-ink-200 text-ink-700 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800 focus-visible:ring-brand-600 group inline-flex min-h-10 items-center gap-2 rounded-full border bg-white py-1.5 pr-2 pl-4 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
                    >
                      {category.title}
                      <span className="bg-ink-100 text-ink-600 group-hover:bg-brand-100 group-hover:text-brand-800 min-w-6 rounded-full px-2 py-0.5 text-center text-xs tabular-nums transition-colors">
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
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Articles                                                           */}
      {/* ------------------------------------------------------------------ */}
      <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
        {posts.length === 0 ? (
          <div className="border-ink-300 rounded-[var(--radius-surface)] border border-dashed bg-white">
            <EmptyState
              icon={Newspaper}
              title="No articles published yet"
              description={
                <>
                  Once an editor publishes a post it will appear here. Staff can sign in to the{' '}
                  <Link
                    href="/admin"
                    className="text-brand-700 font-medium underline underline-offset-4"
                  >
                    admin dashboard
                  </Link>{' '}
                  to write one.
                </>
              }
            />
          </div>
        ) : (
          <>
            {lead ? (
              <div className="mb-14">
                <PostCard post={lead} timezone={settings.timezone} featured />
              </div>
            ) : null}

            {gridPosts.length > 0 ? (
              <>
                <div className="border-ink-200 flex flex-wrap items-baseline justify-between gap-3 border-b pb-4">
                  <h2 className="text-ink-900 text-xl font-bold tracking-tight">
                    {isFirstPage ? 'More articles' : 'Articles'}
                  </h2>
                  <p className="text-ink-500 text-sm">
                    {meta.totalPages > 1
                      ? `Page ${meta.page} of ${meta.totalPages}`
                      : `${meta.total} published`}
                  </p>
                </div>

                <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                  {gridPosts.map((post) => (
                    <PostCard key={post.id} post={post} timezone={settings.timezone} />
                  ))}
                </div>
              </>
            ) : null}

            {meta.totalPages > 1 ? (
              <div className="border-ink-200 shadow-raised mt-10 rounded-[var(--radius-surface)] border bg-white">
                <Pagination
                  meta={meta}
                  itemLabel="articles"
                  buildHref={(page) => (page === 1 ? '/' : `/?page=${page}`)}
                />
              </div>
            ) : (
              <div className="mt-12 flex justify-center">
                <Link
                  href="/search"
                  className="border-ink-300 text-ink-800 hover:bg-ink-50 hover:border-ink-400 focus-visible:ring-brand-600 shadow-raised inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] border bg-white px-5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
                >
                  Search all articles
                  <ArrowRight aria-hidden="true" className="h-4 w-4" />
                </Link>
              </div>
            )}
          </>
        )}
      </section>
    </>
  );
}
