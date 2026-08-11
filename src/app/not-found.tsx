import Link from 'next/link';
import { FileQuestion } from 'lucide-react';

/**
 * Global 404.
 *
 * Reached for genuinely missing routes and, deliberately, for any post or
 * category that is not publicly visible — an unpublished slug must not be
 * distinguishable from one that never existed.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-white px-4 text-center">
      <div className="bg-ink-100 flex h-14 w-14 items-center justify-center rounded-full">
        <FileQuestion aria-hidden="true" className="text-ink-500 h-6 w-6" />
      </div>

      <h1 className="text-ink-900 mt-6 text-2xl font-bold sm:text-3xl">Page not found</h1>
      <p className="text-ink-600 mt-2 max-w-md">
        The page you are looking for does not exist, or it is not published.
      </p>

      <div className="mt-7 flex flex-wrap justify-center gap-3">
        <Link
          href="/"
          className="bg-brand-600 hover:bg-brand-700 inline-flex h-10 items-center rounded-lg px-4 text-sm font-medium text-white shadow-sm"
        >
          Back to the home page
        </Link>
        <Link
          href="/search"
          className="border-ink-300 text-ink-800 hover:bg-ink-50 inline-flex h-10 items-center rounded-lg border bg-white px-4 text-sm font-medium shadow-sm"
        >
          Search articles
        </Link>
      </div>
    </div>
  );
}
