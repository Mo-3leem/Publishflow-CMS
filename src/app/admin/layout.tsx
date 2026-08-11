import type { Metadata } from 'next';
import { Providers } from '@/components/providers';

export const metadata: Metadata = {
  title: { default: 'Admin', template: '%s · PublishFlow Admin' },
  // The admin shell must never be indexed, regardless of robots.txt.
  robots: { index: false, follow: false, nocache: true },
};

/**
 * Admin segment root.
 *
 * Only sets up the client data layer; the session gate lives in the nested
 * `(protected)` layout so that `/admin/login` stays reachable.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <Providers>{children}</Providers>;
}
