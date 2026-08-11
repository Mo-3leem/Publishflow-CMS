'use client';

import * as React from 'react';

/**
 * Fires the de-duplicated read counter once per mount.
 *
 * Deliberately fire-and-forget: the article must render even if counting fails,
 * so a network error here is swallowed rather than surfaced. The server is the
 * one that decides whether the read actually counts.
 */
export function ViewTracker({ slug }: { slug: string }) {
  const fired = React.useRef(false);

  React.useEffect(() => {
    // React 18+ StrictMode double-invokes effects in development; the guard keeps
    // the request to one per page view (the server would ignore the second anyway).
    if (fired.current) return;
    fired.current = true;

    const controller = new AbortController();
    void fetch(`/api/v1/public/posts/${encodeURIComponent(slug)}/view`, {
      method: 'POST',
      credentials: 'same-origin',
      signal: controller.signal,
    }).catch(() => undefined);

    return () => controller.abort();
  }, [slug]);

  return null;
}
