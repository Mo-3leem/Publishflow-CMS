import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ExternalLink, Eye } from 'lucide-react';
import { getPublishedPostBySlug, getRelatedPosts } from '@/server/services/public-service';
import { getPublicSettings } from '@/server/services/settings-service';
import { Markdown } from '@/components/markdown';
import { PostCard } from '@/components/public/post-card';
import { ViewTracker } from '@/components/public/view-tracker';
import { formatDateOnly } from '@/lib/datetime';
import { formatNumber, normalizeBaseUrl } from '@/lib/utils';
import { getEnv } from '@/server/env';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = getPublishedPostBySlug(slug);
  if (!post) return { title: 'Article not found', robots: { index: false, follow: false } };

  const settings = getPublicSettings();
  const base = normalizeBaseUrl(getEnv().APP_URL);
  const canonical = `${base}/posts/${post.slug}`;
  const title = post.seoTitle ?? post.subject;
  const description = post.seoDescription ?? post.excerpt ?? settings.defaultSeoDescription ?? '';
  const image = post.featuredImageId
    ? `${base}/api/v1/public/media/${post.featuredImageId}/file`
    : undefined;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      type: 'article',
      title,
      description,
      url: canonical,
      siteName: settings.siteName,
      publishedTime: post.publishedAt ?? undefined,
      modifiedTime: post.updatedAt,
      authors: [post.authorName],
      ...(image ? { images: [{ url: image, alt: post.featuredImageAlt ?? post.subject }] } : {}),
    },
    twitter: {
      card: image ? 'summary_large_image' : 'summary',
      title,
      description,
      ...(image ? { images: [image] } : {}),
    },
  };
}

export default async function PostPage({ params }: PageProps) {
  const { slug } = await params;
  const post = getPublishedPostBySlug(slug);

  // Draft, in-review, future-scheduled, archived and deleted posts all land here.
  if (!post) notFound();

  const settings = getPublicSettings();
  const related = getRelatedPosts(post.id, post.categorySlug, 3);
  const imageUrl = post.featuredImageId
    ? `/api/v1/public/media/${post.featuredImageId}/file`
    : null;

  return (
    <>
      <ViewTracker slug={post.slug} />

      <article className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        <Link
          href={`/categories/${post.categorySlug}`}
          className="text-ink-500 hover:text-ink-800 inline-flex items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          {post.categoryTitle}
        </Link>

        <h1 className="text-ink-900 mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
          {post.subject}
        </h1>

        <div className="text-ink-500 mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <span>
            By <span className="text-ink-700 font-medium">{post.authorName}</span>
          </span>
          <span aria-hidden="true">·</span>
          <time dateTime={post.publishedAt ?? undefined}>
            {formatDateOnly(post.publishedAt, settings.timezone)}
          </time>
          <span aria-hidden="true">·</span>
          <span className="inline-flex items-center gap-1.5">
            <Eye aria-hidden="true" className="h-4 w-4" />
            {formatNumber(post.readsCount)} {post.readsCount === 1 ? 'read' : 'reads'}
          </span>
        </div>

        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt={post.featuredImageAlt ?? ''}
            className="border-ink-200 mt-8 w-full rounded-xl border object-cover"
          />
        ) : null}

        {post.excerpt ? (
          <p className="border-brand-300 text-ink-600 mt-8 border-l-4 pl-4 text-lg">
            {post.excerpt}
          </p>
        ) : null}

        {/* Markdown only — raw HTML in content is escaped, never executed. */}
        <Markdown content={post.content} className="mt-8" />

        {post.sourceUrl ? (
          <p className="border-ink-200 text-ink-600 mt-10 border-t pt-6 text-sm">
            Source:{' '}
            <a
              href={post.sourceUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="text-brand-700 inline-flex items-center gap-1 underline underline-offset-4"
            >
              {post.sourceUrl}
              <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </p>
        ) : null}
      </article>

      {related.length > 0 ? (
        <section className="border-ink-200 bg-ink-50 border-t">
          <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
            <h2 className="text-ink-900 text-lg font-semibold">More in {post.categoryTitle}</h2>
            <div className="mt-5 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {related.map((item) => (
                <PostCard key={item.id} post={item} timezone={settings.timezone} />
              ))}
            </div>
          </div>
        </section>
      ) : null}
    </>
  );
}
