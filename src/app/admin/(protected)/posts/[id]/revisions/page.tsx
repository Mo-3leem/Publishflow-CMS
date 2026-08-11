import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { getCurrentUser } from '@/server/auth/current-user';
import { getPostForActor } from '@/server/services/post-service';
import { listRevisions } from '@/server/services/revision-service';
import { getPublicSettings } from '@/server/services/settings-service';
import { isAppError } from '@/server/errors/app-error';
import { RevisionBrowser } from '@/components/admin/revision-browser';
import { PostStatusBadge } from '@/components/ui/status-badge';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Revisions' };

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function RevisionsPage({ params }: PageProps) {
  const user = await getCurrentUser();
  if (!user) redirect('/admin/login');

  const { id } = await params;
  const postId = Number(id);
  if (!Number.isInteger(postId) || postId <= 0) notFound();

  let post;
  let revisions;
  try {
    post = getPostForActor(user, postId);
    revisions = listRevisions(user, postId);
  } catch (error) {
    if (isAppError(error) && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN')) notFound();
    throw error;
  }

  const { timezone } = getPublicSettings();

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div>
        <Link
          href={`/admin/posts/${post.id}/edit`}
          className="text-ink-500 hover:text-ink-800 inline-flex items-center gap-1.5 text-sm underline-offset-4 hover:underline"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          Back to the editor
        </Link>

        <h1 className="text-ink-900 mt-3 text-2xl font-bold tracking-tight">Revision history</h1>
        <div className="text-ink-500 mt-2 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-ink-700 font-medium">{post.subject}</span>
          <PostStatusBadge status={post.status} />
          <span className="bg-ink-100 text-ink-700 rounded-md px-2 py-0.5 text-xs font-medium tabular-nums">
            Currently version {post.version}
          </span>
        </div>
      </div>

      <RevisionBrowser post={post} revisions={revisions} user={user} timezone={timezone} />
    </div>
  );
}
