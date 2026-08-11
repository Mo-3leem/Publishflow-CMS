import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/server/auth/current-user';
import { getPublicSettings } from '@/server/services/settings-service';
import { getEnv } from '@/server/env';
import { MediaLibrary } from '@/components/admin/media-library';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Media' };

export default async function MediaPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/admin/login');

  const { timezone } = getPublicSettings();
  const { MAX_UPLOAD_BYTES } = getEnv();

  return (
    <div className="mx-auto max-w-6xl">
      <MediaLibrary user={user} timezone={timezone} maxUploadBytes={MAX_UPLOAD_BYTES} />
    </div>
  );
}
