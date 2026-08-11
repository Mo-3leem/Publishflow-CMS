import type { MetadataRoute } from 'next';
import { listSitemapEntries } from '@/server/services/public-service';
import { normalizeBaseUrl } from '@/lib/utils';
import { getEnv } from '@/server/env';

export const dynamic = 'force-dynamic';

/**
 * Sitemap.
 *
 * Only publicly visible content: the home page, active categories and published
 * posts. Admin and API paths are excluded here and disallowed in robots.txt.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = normalizeBaseUrl(getEnv().APP_URL);
  const { posts, categories } = listSitemapEntries();

  return [
    {
      url: `${base}/`,
      lastModified: posts[0]?.publishedAt ? new Date(posts[0].publishedAt) : new Date(),
      changeFrequency: 'daily',
      priority: 1,
    },
    ...categories.map((category) => ({
      url: `${base}/categories/${category.slug}`,
      lastModified: new Date(category.updatedAt),
      changeFrequency: 'weekly' as const,
      priority: 0.6,
    })),
    ...posts.map((post) => ({
      url: `${base}/posts/${post.slug}`,
      lastModified: new Date(post.updatedAt),
      changeFrequency: 'monthly' as const,
      priority: 0.8,
    })),
  ];
}
