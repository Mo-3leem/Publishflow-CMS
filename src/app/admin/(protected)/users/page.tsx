import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/server/auth/current-user';
import { getPublicSettings } from '@/server/services/settings-service';
import { can } from '@/lib/permissions';
import { UsersManager } from '@/components/admin/users-manager';
import { Alert } from '@/components/ui/surfaces';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Users' };

export default async function UsersPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/admin/login');

  // Also enforced by the API; this only avoids rendering a screen that would
  // fail on every request.
  if (!can(user.role, 'user.manage')) {
    return (
      <div className="mx-auto max-w-2xl">
        <Alert tone="error" title="Not available">
          Only administrators can manage user accounts.
        </Alert>
      </div>
    );
  }

  const { timezone } = getPublicSettings();

  return (
    <div className="mx-auto max-w-5xl">
      <UsersManager currentUser={user} timezone={timezone} />
    </div>
  );
}
