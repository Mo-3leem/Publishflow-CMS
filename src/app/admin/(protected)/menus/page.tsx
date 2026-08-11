import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/server/auth/current-user';
import { can } from '@/lib/permissions';
import { MenuBuilder } from '@/components/admin/menu-builder';
import { Alert } from '@/components/ui/surfaces';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Menus' };

export default async function MenusPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/admin/login');

  if (!can(user.role, 'menu.manage')) {
    return (
      <div className="mx-auto max-w-2xl">
        <Alert tone="error" title="Not available">
          Only editors and administrators can manage navigation menus.
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      <MenuBuilder canManage />
    </div>
  );
}
