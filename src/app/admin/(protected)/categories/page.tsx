import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/server/auth/current-user';
import { can } from '@/lib/permissions';
import { CategoriesManager } from '@/components/admin/categories-manager';
import { Alert } from '@/components/ui/surfaces';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Categories' };

export default async function CategoriesPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/admin/login');

  // Authors can read categories (they file posts into them) but not change them.
  const canManage = can(user.role, 'category.manage');

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      {!canManage ? (
        <Alert tone="info">
          You can view categories but only editors and administrators can change them.
        </Alert>
      ) : null}
      <CategoriesManager canManage={canManage} />
    </div>
  );
}
