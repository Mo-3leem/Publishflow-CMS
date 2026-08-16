import type { Metadata } from 'next';
import { SearchX, Search as SearchIcon } from 'lucide-react';
import { searchPublishedPosts } from '@/server/services/search-service';
import { listPublicCategories } from '@/server/services/public-service';
import { getPublicSettings } from '@/server/services/settings-service';
import { PostCard } from '@/components/public/post-card';
import { EmptyState } from '@/components/ui/surfaces';
import { Pagination } from '@/components/ui/pagination';
import { Button } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Search',
  description: 'Search published articles.',
  // A search results page has no stable content worth indexing.
  robots: { index: false, follow: true },
};

interface PageProps {
  searchParams: Promise<{ q?: string; page?: string; category?: string }>;
}

export default async function SearchPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const query = (params.q ?? '').trim();
  const settings = getPublicSettings();
  const categories = listPublicCategories();

  const result = query
    ? searchPublishedPosts(
        {
          q: query,
          page: params.page,
          categorySlug: params.category ?? null,
        },
        settings.postsPerPage,
      )
    : null;

  const buildHref = (page: number) => {
    const search = new URLSearchParams();
    if (query) search.set('q', query);
    if (params.category) search.set('category', params.category);
    if (page > 1) search.set('page', String(page));
    const qs = search.toString();
    return qs ? `/search?${qs}` : '/search';
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
      <h1 className="text-ink-900 text-3xl font-bold tracking-tight">Search</h1>
      <p className="text-ink-600 mt-2">Find published articles by title, summary or content.</p>

      {/* GET form: the query lives in the URL so results are shareable and refreshable. */}
      <form method="GET" action="/search" className="mt-6 flex flex-col gap-3 sm:flex-row">
        <div className="flex-1">
          <label htmlFor="q" className="sr-only">
            Search query
          </label>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={query}
            placeholder="e.g. optimistic locking"
            maxLength={120}
            autoComplete="off"
            className="border-ink-300 placeholder:text-ink-400 hover:border-ink-400 focus-visible:border-brand-500 focus-visible:ring-brand-500/40 shadow-raised h-11 w-full rounded-[var(--radius-control)] border bg-white px-4 text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
          />
        </div>

        <div className="sm:w-56">
          <label htmlFor="category" className="sr-only">
            Filter by category
          </label>
          <select
            id="category"
            name="category"
            defaultValue={params.category ?? ''}
            className="border-ink-300 hover:border-ink-400 focus-visible:border-brand-500 focus-visible:ring-brand-500/40 shadow-raised h-11 w-full rounded-[var(--radius-control)] border bg-white px-3 text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            <option value="">All categories</option>
            {categories.map((category) => (
              <option key={category.id} value={category.slug}>
                {category.title}
              </option>
            ))}
          </select>
        </div>

        <Button type="submit" size="lg" className="sm:w-auto">
          <SearchIcon aria-hidden="true" className="h-4 w-4" />
          Search
        </Button>
      </form>

      <section className="mt-10" aria-labelledby="search-results">
        {/* Keeps the outline h1 -> h2 -> h3; the page heading already says
            "Search", so this label is for assistive tech only. */}
        <h2 id="search-results" className="sr-only">
          Search results
        </h2>
        {!result ? (
          <div className="border-ink-300 rounded-[var(--radius-surface)] border border-dashed bg-white">
            <EmptyState
              icon={SearchIcon}
              title="Enter a search term"
              description="Search titles, summaries and article bodies. Results only ever include published articles."
            />
          </div>
        ) : result.data.length === 0 ? (
          <div className="border-ink-300 rounded-[var(--radius-surface)] border border-dashed bg-white">
            <EmptyState
              icon={SearchX}
              title={`No results for “${query}”`}
              description="Check the spelling, try a shorter or more general term, or clear the category filter."
            />
          </div>
        ) : (
          <>
            <p className="text-ink-500 text-sm" role="status">
              {result.meta.total} {result.meta.total === 1 ? 'result' : 'results'} for{' '}
              <span className="text-ink-800 font-medium">“{query}”</span>
            </p>

            <div className="mt-5 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {result.data.map((post) => (
                <PostCard key={post.id} post={post} timezone={settings.timezone} />
              ))}
            </div>

            {result.meta.totalPages > 1 ? (
              <div className="border-ink-200 mt-8 rounded-xl border bg-white">
                <Pagination meta={result.meta} itemLabel="results" buildHref={buildHref} />
              </div>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
