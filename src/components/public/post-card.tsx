import Link from 'next/link';
import { ArrowRight, Eye } from 'lucide-react';
import type { PublicPostSummary } from '@/server/services/public-service';
import { formatDateOnly } from '@/lib/datetime';
import { formatNumber } from '@/lib/utils';

/**
 * Article card.
 *
 * Two treatments from one component: `featured` is the lead story, everything
 * else is a grid item. Both are designed to hold up without an image, because
 * an editorial CMS cannot assume every post has one — the type does the work,
 * and no space is reserved for media that may not exist.
 */
export function PostCard({
  post,
  timezone,
  featured = false,
}: {
  post: PublicPostSummary;
  timezone: string;
  featured?: boolean;
}) {
  const imageUrl = post.featuredImageId
    ? `/api/v1/public/media/${post.featuredImageId}/file`
    : null;

  const meta = (
    <div className="text-ink-500 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <span className="text-ink-700 font-medium">{post.authorName}</span>
      <span aria-hidden="true" className="text-ink-300">
        ·
      </span>
      <time dateTime={post.publishedAt ?? undefined}>
        {formatDateOnly(post.publishedAt, timezone)}
      </time>
      {post.readsCount > 0 ? (
        <>
          <span aria-hidden="true" className="text-ink-300">
            ·
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Eye aria-hidden="true" className="h-3.5 w-3.5" />
            {formatNumber(post.readsCount)}
            <span className="sr-only">reads</span>
          </span>
        </>
      ) : null}
    </div>
  );

  const categoryChip = (
    <Link
      href={`/categories/${post.categorySlug}`}
      className="bg-brand-50 text-brand-800 ring-brand-200 hover:bg-brand-100 focus-visible:ring-brand-600 inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition-colors ring-inset focus-visible:ring-2 focus-visible:outline-none"
    >
      {post.categoryTitle}
    </Link>
  );

  if (featured) {
    return (
      <article className="group border-ink-200 shadow-raised focus-within:ring-brand-600 relative overflow-hidden rounded-[var(--radius-surface)] border bg-white transition-shadow focus-within:ring-2 focus-within:ring-offset-2 hover:shadow-md">
        <div className={imageUrl ? 'grid gap-0 lg:grid-cols-2' : ''}>
          {imageUrl ? (
            <div className="bg-ink-100 relative aspect-[16/10] lg:aspect-auto lg:h-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageUrl}
                alt={post.featuredImageAlt ?? ''}
                className="h-full w-full object-cover"
              />
            </div>
          ) : null}

          <div className="flex flex-col justify-center p-6 sm:p-8 lg:p-10">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="text-brand-700 text-xs font-semibold tracking-[0.14em] uppercase">
                Latest
              </span>
              {categoryChip}
            </div>

            <h2 className="text-ink-900 mt-4 text-2xl leading-tight font-bold tracking-tight text-balance sm:text-3xl lg:text-4xl">
              {/* Only the title is the link: wrapping the card would nest the
                  category anchor inside another anchor, which is invalid HTML.
                  The stretched-link span gives the whole card a click target
                  without that nesting. */}
              <Link href={`/posts/${post.slug}`} className="focus-visible:outline-none">
                <span aria-hidden="true" className="absolute inset-0 z-0" />
                <span className="group-hover:text-brand-800 relative z-10 transition-colors">
                  {post.subject}
                </span>
              </Link>
            </h2>

            {post.excerpt ? (
              <p className="text-ink-600 relative z-10 mt-4 line-clamp-3 text-base leading-relaxed text-pretty sm:text-lg">
                {post.excerpt}
              </p>
            ) : null}

            <div className="relative z-10 mt-6 flex flex-wrap items-center justify-between gap-3">
              {meta}
              <span className="text-brand-700 group-hover:text-brand-800 inline-flex items-center gap-1.5 text-sm font-semibold">
                Read article
                <ArrowRight
                  aria-hidden="true"
                  className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
                />
              </span>
            </div>
          </div>
        </div>
      </article>
    );
  }

  return (
    <article className="group border-ink-200 hover:border-ink-300 focus-within:ring-brand-600 relative flex h-full flex-col overflow-hidden rounded-[var(--radius-surface)] border bg-white transition-all focus-within:ring-2 focus-within:ring-offset-2 hover:shadow-md">
      {imageUrl ? (
        <div className="bg-ink-100 aspect-[16/9] w-full overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt={post.featuredImageAlt ?? ''}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
            loading="lazy"
          />
        </div>
      ) : null}

      <div className="flex flex-1 flex-col p-5">
        {categoryChip}

        <h3 className="text-ink-900 mt-3 text-lg leading-snug font-semibold tracking-tight text-balance">
          <Link href={`/posts/${post.slug}`} className="focus-visible:outline-none">
            <span aria-hidden="true" className="absolute inset-0 z-0" />
            <span className="group-hover:text-brand-800 relative z-10 transition-colors">
              {post.subject}
            </span>
          </Link>
        </h3>

        {post.excerpt ? (
          <p className="text-ink-600 relative z-10 mt-2 line-clamp-3 flex-1 text-sm leading-relaxed text-pretty">
            {post.excerpt}
          </p>
        ) : (
          <div className="flex-1" />
        )}

        <div className="border-ink-100 relative z-10 mt-4 border-t pt-3.5">{meta}</div>
      </div>
    </article>
  );
}
