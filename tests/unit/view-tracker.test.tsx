// @vitest-environment jsdom
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { ViewTracker } from '@/components/public/view-tracker';

/**
 * Regression tests for the read counter that silently stopped counting.
 *
 * The tracker used to abort its own request from the effect cleanup. Under
 * StrictMode React mounts, cleans up, then remounts, so that cleanup cancelled
 * the only request the component ever sent — the effect's guard stopped the
 * remount from issuing a replacement. Whether a read survived came down to a
 * race between the browser flushing the POST and the abort landing.
 */

interface FetchCall {
  url: string;
  init: RequestInit;
}

/** Records calls and keeps requests pending, so nothing resolves the race for us. */
function stubFetch(): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    return new Promise<Response>(() => {
      // Never settles: a real POST is still in flight when cleanup runs.
    });
  });
  return calls;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ViewTracker records the read exactly once', () => {
  it('sends one POST to the view endpoint on mount', async () => {
    const calls = stubFetch();

    await act(async () => {
      render(<ViewTracker slug="a-published-post" />);
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('/api/v1/public/posts/a-published-post/view');
    expect(calls[0]?.init.method).toBe('POST');
  });

  it('percent-encodes the slug rather than interpolating it raw', async () => {
    const calls = stubFetch();

    await act(async () => {
      render(<ViewTracker slug="a/b?c" />);
    });

    expect(calls[0]?.url).toBe('/api/v1/public/posts/a%2Fb%3Fc/view');
  });
});

describe('effect cleanup cannot cancel the read', () => {
  /**
   * The exact root cause. Under StrictMode the mount/cleanup/remount cycle runs
   * before any network I/O completes; the request must survive it.
   */
  it('still has exactly one live, uncancelled request under StrictMode', async () => {
    const calls = stubFetch();

    await act(async () => {
      render(
        <React.StrictMode>
          <ViewTracker slug="strict-mode-post" />
        </React.StrictMode>,
      );
    });

    // StrictMode must not turn one read into two.
    expect(calls).toHaveLength(1);

    const signal = calls[0]?.init.signal;
    // Either no signal at all, or one that nothing has aborted.
    expect(signal == null || signal.aborted === false).toBe(true);
  });

  it('does not abort the request when the component unmounts', async () => {
    const calls = stubFetch();

    const view = await act(async () => render(<ViewTracker slug="unmounted-post" />));

    expect(calls).toHaveLength(1);

    await act(async () => {
      view.unmount();
    });

    const signal = calls[0]?.init.signal;
    expect(signal == null || signal.aborted === false).toBe(true);
  });

  it('uses keepalive so the read outlives a navigation away', async () => {
    const calls = stubFetch();

    await act(async () => {
      render(<ViewTracker slug="navigated-away" />);
    });

    expect(calls[0]?.init.keepalive).toBe(true);
  });
});

describe('one read per article, not one per component instance', () => {
  it('does not re-send when the same slug re-renders', async () => {
    const calls = stubFetch();

    const view = await act(async () => render(<ViewTracker slug="same-post" />));
    await act(async () => {
      view.rerender(<ViewTracker slug="same-post" />);
    });

    expect(calls).toHaveLength(1);
  });

  /**
   * The App Router reuses this component across a client-side navigation between
   * two articles. A boolean "already fired" guard would latch on the first slug
   * and drop every later read.
   */
  it('sends a second read when the slug changes without a remount', async () => {
    const calls = stubFetch();

    const view = await act(async () => render(<ViewTracker slug="first-post" />));
    await act(async () => {
      view.rerender(<ViewTracker slug="second-post" />);
    });

    expect(calls.map((call) => call.url)).toEqual([
      '/api/v1/public/posts/first-post/view',
      '/api/v1/public/posts/second-post/view',
    ]);
  });
});
