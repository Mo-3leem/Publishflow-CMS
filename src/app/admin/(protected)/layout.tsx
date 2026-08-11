import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/server/auth/current-user';
import { getPublicSettings } from '@/server/services/settings-service';
import { AdminShell } from '@/components/admin/admin-shell';

export const dynamic = 'force-dynamic';

/**
 * Session gate for every authenticated admin screen.
 *
 * Checked on the server before any protected markup is produced. This is a
 * usability boundary, not the security boundary — each API route independently
 * verifies the session and the caller's role.
 */
export default async function ProtectedAdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/admin/login');

  const settings = getPublicSettings();

  return (
    <AdminShell user={user} siteName={settings.siteName}>
      {children}
    </AdminShell>
  );
}
