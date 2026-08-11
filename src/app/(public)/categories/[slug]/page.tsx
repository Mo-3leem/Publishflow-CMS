import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Newspaper } from 'lucide-react';
import { getActiveCategoryBySlug } from '@/server/services/category-service';
import { listPublishedPosts } from '@/server/services/public-service';
import { getPublicSettings } from '@/server/services/settings-service';
import { PostCard } from '@/components/public/post-card';
import { EmptyState } from '@/components/ui/surfaces';
import { Pagination } from '@/components/ui/pagination';
import { normalizeBaseUrl } from '@/lib/utils';
import { getEnv } from '@/server/env';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const category = getActiveCategoryBySlug(slug);
  if (!category) return { title: 'Category not found', robots: { index: false, follow: false } };

  const settings = getPublicSettings();
  const canonical = `${normalizeBaseUrl(getEnv().APP_URL)}/categories/${category.slug}`;
  const description = category.description || `Articles filed under ${category.title}.`;

  return {
    title: category.title,
    description,
    alternates: { canonical },
    openGraph: {
      type: 'website',
      title: `${category.title} · ${settings.siteName}`,
      description,
      url: canonical,
      siteName: settings.siteName,
    },
  };
}

export default async function CategoryPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const { page } = await searchParams;

  // Inactive categories are treated as missing, so deactivating one removes it
  // from the public site without deleting historical post data.
  const category = getActiveCategoryBySlug(slug);
  if (!category) notFound();

  const settings = getPublicSettings();
  const { data: posts, meta } = listPublishedPosts(
    { page, categorySlug: category.slug },
    settings.postsPerPage,
  );

  return (
    <>
      <header className="border-ink-200 bg-ink-50 border-b">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
          <p className="text-brand-700 text-sm font-medium">Category</p>
          <h1 className="text-ink-900 mt-1.5 text-3xl font-bold tracking-tight">
            {category.title}
          </h1>
          {category.description ? (
            <p className="text-ink-600 mt-3 max-w-2xl">{category.description}</p>
          ) : null}
          <p className="text-ink-500 mt-4 text-sm">
            {meta.total} published {meta.total === 1 ? 'article' : 'articles'}
          </p>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        {posts.length === 0 ? (
          <div className="border-ink-300 rounded-xl border border-dashed bg-white">
            <EmptyState
              icon={Newspaper}
              title={`Nothing published in ${category.title} yet`}
              description="Articles appear here once an editor publishes them."
            />
          </div>
        ) : (
          <>
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {posts.map((post) => (
                <PostCard key={post.id} post={post} timezone={settings.timezone} />
              ))}
            </div>

            {meta.totalPages > 1 ? (
              <div className="border-ink-200 mt-8 rounded-xl border bg-white">
                <Pagination
                  meta={meta}
                  itemLabel="articles"
                  buildHref={(target) =>
                    target === 1
                      ? `/categories/${category.slug}`
                      : `/categories/${category.slug}?page=${target}`
                  }
                />
              </div>
            ) : null}
          </>
        )}
      </section>
    </>
  );
}
