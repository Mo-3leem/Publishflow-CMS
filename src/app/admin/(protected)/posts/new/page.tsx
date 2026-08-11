import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/server/auth/current-user';
import { listCategories } from '@/server/services/category-service';
import { getPublicSettings } from '@/server/services/settings-service';
import { can } from '@/lib/permissions';
import { PostEditor } from '@/components/admin/post-editor';
import { Alert } from '@/components/ui/surfaces';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'New post' };

export default async function NewPostPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/admin/login');

  const categories = listCategories();
  const { timezone } = getPublicSettings();

  // A post requires a category, so there is nothing useful to render without one.
  if (categories.length === 0) {
    return (
      <div className="mx-auto max-w-2xl">
        <Alert tone="warning" title="No categories exist yet">
          <p>Every post must belong to a category. Create one first.</p>
          {can(user.role, 'category.manage') ? (
            <p className="mt-2">
              <Link href="/admin/categories" className="font-medium underline underline-offset-4">
                Go to categories
              </Link>
            </p>
          ) : (
            <p className="mt-2">Ask an editor or administrator to add one.</p>
          )}
        </Alert>
      </div>
    );
  }

  return <PostEditor mode="create" user={user} categories={categories} timezone={timezone} />;
}
