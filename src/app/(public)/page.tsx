import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Newspaper } from 'lucide-react';
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
  const [lead, ...rest] = posts;

  return (
    <>
      <section className="border-ink-200 from-ink-50 relative border-b bg-gradient-to-b to-white">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
          <p className="text-brand-700 text-xs font-semibold tracking-[0.12em] uppercase">
            {meta.total > 0
              ? `${meta.total} published ${meta.total === 1 ? 'article' : 'articles'}`
              : 'Editorial'}
          </p>
          <h1 className="text-ink-900 mt-2.5 max-w-3xl text-4xl font-bold tracking-tight text-balance sm:text-5xl">
            {settings.siteName}
          </h1>
          {settings.siteDescription ? (
            <p className="text-ink-600 mt-4 max-w-2xl text-lg leading-relaxed text-pretty">
              {settings.siteDescription}
            </p>
          ) : null}

          {categories.length > 0 ? (
            <nav aria-label="Categories" className="mt-8 flex flex-wrap gap-2">
              {categories.map((category) => (
                <Link
                  key={category.id}
                  href={`/categories/${category.slug}`}
                  className="border-ink-200 text-ink-700 hover:border-brand-300 hover:bg-brand-50/60 hover:text-brand-800 inline-flex items-center gap-2 rounded-full border bg-white py-1.5 pr-2.5 pl-3.5 text-sm font-medium shadow-sm transition-colors"
                >
                  {category.title}
                  <span className="bg-ink-100 text-ink-600 rounded-full px-1.5 py-0.5 text-xs tabular-nums">
                    {category.postCount}
                    <span className="sr-only">
                      {' '}
                      {category.postCount === 1 ? 'article' : 'articles'}
                    </span>
                  </span>
                </Link>
              ))}
            </nav>
          ) : null}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-ink-900 text-xl font-semibold">Latest articles</h2>
          {/* The total is already stated in the hero, so this links onward instead
              of repeating it. */}
          {meta.totalPages > 1 ? (
            <p className="text-ink-500 text-sm">
              Page {meta.page} of {meta.totalPages}
            </p>
          ) : null}
        </div>

        {posts.length === 0 ? (
          <div className="border-ink-300 mt-6 rounded-xl border border-dashed bg-white">
            <EmptyState
              icon={Newspaper}
              title="No articles published yet"
              description={
                <>
                  Once an editor publishes a post it will appear here. Staff can sign in to the{' '}
                  <Link href="/admin" className="text-brand-700 underline underline-offset-4">
                    admin dashboard
                  </Link>{' '}
                  to write one.
                </>
              }
            />
          </div>
        ) : (
          <>
            <div className="mt-6 space-y-6">
              {lead ? <PostCard post={lead} timezone={settings.timezone} featured /> : null}

              {rest.length > 0 ? (
                <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                  {rest.map((post) => (
                    <PostCard key={post.id} post={post} timezone={settings.timezone} />
                  ))}
                </div>
              ) : null}
            </div>

            {meta.totalPages > 1 ? (
              <div className="border-ink-200 mt-8 rounded-xl border bg-white">
                <Pagination
                  meta={meta}
                  itemLabel="articles"
                  buildHref={(page) => (page === 1 ? '/' : `/?page=${page}`)}
                />
              </div>
            ) : null}

            <div className="mt-8">
              <Link
                href="/search"
                className="text-brand-700 inline-flex items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline"
              >
                Search all articles
                <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </Link>
            </div>
          </>
        )}
      </section>
    </>
  );
}
