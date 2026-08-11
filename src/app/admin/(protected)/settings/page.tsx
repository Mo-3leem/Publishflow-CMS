import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/server/auth/current-user';
import { getSettingsForAdmin } from '@/server/services/settings-service';
import { can } from '@/lib/permissions';
import { SettingsForm } from '@/components/admin/settings-form';
import { Alert } from '@/components/ui/surfaces';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Settings' };

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/admin/login');

  if (!can(user.role, 'settings.manage')) {
    return (
      <div className="mx-auto max-w-2xl">
        <Alert tone="error" title="Not available">
          Only administrators can change site settings.
        </Alert>
      </div>
    );
  }

  const settings = getSettingsForAdmin(user);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-ink-900 text-2xl font-bold tracking-tight">Site settings</h1>
        <p className="text-ink-500 mt-1 text-sm">
          Identity, default SEO and display preferences for the public site.
        </p>
      </div>

      <SettingsForm settings={settings} />
    </div>
  );
}
