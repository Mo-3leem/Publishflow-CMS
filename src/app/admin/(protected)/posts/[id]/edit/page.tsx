import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getCurrentUser } from '@/server/auth/current-user';
import { getPostForActor, listWorkflowEvents } from '@/server/services/post-service';
import { listCategories } from '@/server/services/category-service';
import { getPublicSettings } from '@/server/services/settings-service';
import { isAppError } from '@/server/errors/app-error';
import { PostEditor } from '@/components/admin/post-editor';
import { Card, CardHeader } from '@/components/ui/surfaces';
import { formatInTimezone } from '@/lib/datetime';
import { POST_STATUS_LABELS, type PostStatus } from '@/lib/domain';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return { title: 'Edit post' };
  try {
    const post = getPostForActor(user, Number(id));
    return { title: `Edit: ${post.subject}` };
  } catch {
    return { title: 'Edit post' };
  }
}

export default async function EditPostPage({ params }: PageProps) {
  const user = await getCurrentUser();
  if (!user) redirect('/admin/login');

  const { id } = await params;
  const postId = Number(id);
  if (!Number.isInteger(postId) || postId <= 0) notFound();

  let post;
  let events;
  try {
    post = getPostForActor(user, postId);
    events = listWorkflowEvents(user, postId);
  } catch (error) {
    // The service reports "not readable by you" as NOT_FOUND on purpose, so an
    // author cannot probe for the existence of another author's drafts.
    if (isAppError(error) && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN')) notFound();
    throw error;
  }

  const categories = listCategories();
  const { timezone } = getPublicSettings();

  return (
    <div className="space-y-5">
      <PostEditor mode="edit" user={user} categories={categories} timezone={timezone} post={post} />

      {events.length > 0 ? (
        <div className="mx-auto max-w-6xl">
          <Card>
            <CardHeader
              title="Workflow history"
              description="Every status change, with the reviewer's note where one was given."
            />
            <ol className="divide-ink-200 divide-y">
              {events.map((event) => (
                <li key={event.id} className="px-5 py-3.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-ink-800 text-sm">
                      <span className="font-medium">{event.actorName}</span>{' '}
                      <span className="text-ink-500">
                        {event.fromStatus
                          ? `moved ${POST_STATUS_LABELS[event.fromStatus as PostStatus] ?? event.fromStatus} → `
                          : 'set status to '}
                      </span>
                      <span className="font-medium">
                        {POST_STATUS_LABELS[event.toStatus as PostStatus] ?? event.toStatus}
                      </span>
                    </p>
                    <time className="text-ink-400 text-xs">
                      {formatInTimezone(event.createdAt, timezone)}
                    </time>
                  </div>
                  {event.comment ? (
                    <blockquote className="border-ink-300 bg-ink-50 text-ink-600 mt-2 border-l-2 px-3 py-2 text-sm">
                      {event.comment}
                    </blockquote>
                  ) : null}
                </li>
              ))}
            </ol>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
