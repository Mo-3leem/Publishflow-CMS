import Link from 'next/link';
import { Eye } from 'lucide-react';
import type { PublicPostSummary } from '@/server/services/public-service';
import { formatDateOnly } from '@/lib/datetime';
import { formatNumber } from '@/lib/utils';

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

  return (
    <article
      className={`group border-ink-200 flex flex-col overflow-hidden rounded-xl border bg-white transition-shadow hover:shadow-md ${
        featured ? 'sm:flex-row' : ''
      }`}
    >
      {imageUrl ? (
        <div className={featured ? 'sm:w-2/5' : ''}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt={post.featuredImageAlt ?? ''}
            className={`w-full object-cover ${featured ? 'h-48 sm:h-full' : 'h-44'}`}
            loading="lazy"
          />
        </div>
      ) : null}

      <div className="flex flex-1 flex-col p-5">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Link
            href={`/categories/${post.categorySlug}`}
            className="bg-brand-50 text-brand-800 ring-brand-200 hover:bg-brand-100 rounded-full px-2.5 py-1 font-medium ring-1 ring-inset"
          >
            {post.categoryTitle}
          </Link>
          <time dateTime={post.publishedAt ?? undefined} className="text-ink-500">
            {formatDateOnly(post.publishedAt, timezone)}
          </time>
        </div>

        <h3 className={`text-ink-900 mt-3 font-semibold ${featured ? 'text-xl' : 'text-lg'}`}>
          {/* Only the title is the link — wrapping the whole card would nest the
              category anchor inside another anchor, which is invalid HTML. */}
          <Link href={`/posts/${post.slug}`} className="hover:text-brand-700">
            {post.subject}
          </Link>
        </h3>

        {post.excerpt ? (
          <p className="text-ink-600 mt-2 line-clamp-3 flex-1 text-sm">{post.excerpt}</p>
        ) : (
          <div className="flex-1" />
        )}

        <div className="text-ink-500 mt-4 flex items-center justify-between gap-3 text-xs">
          <span>By {post.authorName}</span>
          <span className="inline-flex items-center gap-1.5">
            <Eye aria-hidden="true" className="h-3.5 w-3.5" />
            {formatNumber(post.readsCount)}
            <span className="sr-only">reads</span>
          </span>
        </div>
      </div>
    </article>
  );
}
