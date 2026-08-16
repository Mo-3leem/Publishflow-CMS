'use client';

import * as React from 'react';

/**
 * Fires the de-duplicated read counter once per article.
 *
 * Deliberately fire-and-forget: the article must render even if counting fails,
 * so a network error here is swallowed rather than surfaced. The server is the
 * one that decides whether the read actually counts — this component only makes
 * sure the request is sent exactly once and is never cancelled.
 */
export function ViewTracker({ slug }: { slug: string }) {
  /**
   * The slug already counted by this instance, not a boolean.
   *
   * A boolean latched forever: the App Router keeps this component mounted
   * across a client-side navigation from one article to another, so the guard
   * would still be set and every article after the first would go uncounted.
   */
  const countedSlug = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (countedSlug.current === slug) return;
    countedSlug.current = slug;

    /*
     * No AbortController, and nothing torn down on cleanup.
     *
     * StrictMode mounts, runs cleanup, then remounts. Aborting from cleanup
     * cancelled the single request this component ever sends — the effect's own
     * guard meant the remount never issued a replacement — so whether a read was
     * recorded came down to a race between the browser flushing the POST and the
     * abort landing. On localhost the flush usually won; over a higher-latency
     * proxy it usually lost, and the read silently vanished.
     *
     * `keepalive` lets the request outlive the page so a reader who navigates
     * away immediately is still counted. There is no state to set and no
     * response to read, so there is nothing an unmount needs to clean up.
     */
    void fetch(`/api/v1/public/posts/${encodeURIComponent(slug)}/view`, {
      method: 'POST',
      credentials: 'same-origin',
      keepalive: true,
    }).catch(() => undefined);
  }, [slug]);

  return null;
}
