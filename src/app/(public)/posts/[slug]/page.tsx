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

      {/* The column is sized for reading; the header and media are allowed to
          breathe slightly wider than the body text. */}
      <article className="mx-auto max-w-2xl px-4 py-10 sm:px-6 sm:py-16">
        <Link
          href={`/categories/${post.categorySlug}`}
          className="text-ink-500 hover:text-ink-900 focus-visible:ring-brand-600 -mx-2 inline-flex min-h-9 items-center gap-1.5 rounded-[var(--radius-control)] px-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          {post.categoryTitle}
        </Link>

        <h1 className="text-ink-900 mt-4 text-3xl leading-[1.15] font-bold tracking-tight text-balance sm:text-[2.75rem]">
          {post.subject}
        </h1>

        {/* Standfirst: the excerpt reads as an introduction rather than a
            quotation, so it no longer carries a quote-style left rule. */}
        {post.excerpt ? (
          <p className="text-ink-600 mt-5 text-lg leading-relaxed text-pretty sm:text-xl">
            {post.excerpt}
          </p>
        ) : null}

        <div className="border-ink-200 text-ink-500 mt-7 flex flex-wrap items-center gap-x-3 gap-y-2 border-y py-4 text-sm">
          <span>
            By <span className="text-ink-800 font-medium">{post.authorName}</span>
          </span>
          <span aria-hidden="true" className="text-ink-300">
            ·
          </span>
          <time dateTime={post.publishedAt ?? undefined}>
            {formatDateOnly(post.publishedAt, settings.timezone)}
          </time>
          <span aria-hidden="true" className="text-ink-300">
            ·
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Eye aria-hidden="true" className="h-4 w-4" />
            {formatNumber(post.readsCount)} {post.readsCount === 1 ? 'read' : 'reads'}
          </span>
        </div>

        {imageUrl ? (
          <figure className="mt-10">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl}
              alt={post.featuredImageAlt ?? ''}
              className="border-ink-200 w-full rounded-[var(--radius-surface)] border object-cover"
            />
            {post.featuredImageAlt ? (
              <figcaption className="text-ink-500 mt-3 text-sm">{post.featuredImageAlt}</figcaption>
            ) : null}
          </figure>
        ) : null}

        {/* Markdown only — raw HTML in content is escaped, never executed. */}
        <Markdown content={post.content} className="mt-10" />

        {post.sourceUrl ? (
          <aside className="border-ink-200 bg-ink-50 mt-12 rounded-[var(--radius-surface)] border p-4">
            <h2 className="text-ink-900 text-xs font-semibold tracking-wider uppercase">Source</h2>
            <a
              href={post.sourceUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="text-brand-700 hover:text-brand-800 focus-visible:ring-brand-600 mt-2 inline-flex items-start gap-1.5 rounded-[var(--radius-control)] text-sm break-all underline underline-offset-4 focus-visible:ring-2 focus-visible:outline-none"
            >
              {post.sourceUrl}
              <ExternalLink aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </aside>
        ) : null}
      </article>

      {related.length > 0 ? (
        <section className="border-ink-200 bg-ink-50 border-t">
          <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="text-ink-900 text-xl font-bold tracking-tight">
                More in {post.categoryTitle}
              </h2>
              <Link
                href={`/categories/${post.categorySlug}`}
                className="text-brand-700 hover:text-brand-800 focus-visible:ring-brand-600 rounded-[var(--radius-control)] text-sm font-medium underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:outline-none"
              >
                View all
              </Link>
            </div>
            <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
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
