import type { MetadataRoute } from 'next';
import { normalizeBaseUrl } from '@/lib/utils';
import { getEnv } from '@/server/env';

export const dynamic = 'force-dynamic';

export default function robots(): MetadataRoute.Robots {
  const base = normalizeBaseUrl(getEnv().APP_URL);

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // The admin shell and the API are never useful in an index, and /search
        // generates unbounded crawl paths.
        disallow: ['/admin', '/admin/', '/api/', '/search'],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
