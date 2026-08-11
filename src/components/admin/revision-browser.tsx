'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { diffLines } from 'diff';
import { toast } from 'sonner';
import { Eye, Undo2, GitCompare } from 'lucide-react';
import type { RevisionDetail, RevisionSummary } from '@/server/services/revision-service';
import type { PostDetail } from '@/server/services/post-service';
import type { Principal } from '@/lib/domain';
import { can } from '@/lib/permissions';
import { api, ApiError } from '@/client/api-client';
import { queryKeys } from '@/client/query-keys';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, Alert, Skeleton } from '@/components/ui/surfaces';
import { Dialog, ConfirmDialog } from '@/components/ui/dialog';
import { Markdown } from '@/components/markdown';
import { formatInTimezone } from '@/lib/datetime';
import { POST_STATUS_LABELS, type PostStatus } from '@/lib/domain';

/**
 * Revision history browser.
 *
 * History is append-only: restoring writes the old content forward as a new
 * version, so nothing here can destroy a stored revision.
 */
export function RevisionBrowser({
  post,
  revisions,
  user,
  timezone,
}: {
  post: PostDetail;
  revisions: RevisionSummary[];
  user: Principal;
  timezone: string;
}) {
  const router = useRouter();
  const [previewId, setPreviewId] = React.useState<number | null>(null);
  const [restoreTarget, setRestoreTarget] = React.useState<RevisionSummary | null>(null);
  const [restoring, setRestoring] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [leftId, setLeftId] = React.useState<number | null>(revisions[1]?.id ?? null);
  const [rightId, setRightId] = React.useState<number | null>(revisions[0]?.id ?? null);
  const [comparing, setComparing] = React.useState(false);

  const mayRestore = can(user.role, 'revision.restore');

  const restore = async () => {
    if (!restoreTarget) return;
    setRestoring(true);
    setError(null);
    try {
      await api.post(`/posts/${post.id}/revisions/${restoreTarget.id}/restore`, {
        expectedVersion: post.version,
        changeSummary: `Restored content from version ${restoreTarget.version}`,
      });
      toast.success(`Version ${restoreTarget.version} restored as a new version.`);
      setRestoreTarget(null);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not restore this revision.');
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div className="space-y-5">
      {error ? <Alert tone="error">{error}</Alert> : null}

      <Card>
        <CardHeader
          title="Compare two versions"
          description="Select any two revisions to see a line-by-line difference."
          action={
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!leftId || !rightId || leftId === rightId}
              onClick={() => setComparing(true)}
            >
              <GitCompare aria-hidden="true" className="h-4 w-4" />
              Compare
            </Button>
          }
        />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <div>
            <label htmlFor="diff-left" className="text-ink-800 block text-sm font-medium">
              Older version
            </label>
            <select
              id="diff-left"
              value={leftId ?? ''}
              onChange={(event) => setLeftId(Number(event.target.value) || null)}
              className="border-ink-300 mt-1.5 h-10 w-full rounded-lg border bg-white px-3 text-sm"
            >
              <option value="">Select…</option>
              {revisions.map((revision) => (
                <option key={revision.id} value={revision.id}>
                  v{revision.version} — {revision.savedByName}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="diff-right" className="text-ink-800 block text-sm font-medium">
              Newer version
            </label>
            <select
              id="diff-right"
              value={rightId ?? ''}
              onChange={(event) => setRightId(Number(event.target.value) || null)}
              className="border-ink-300 mt-1.5 h-10 w-full rounded-lg border bg-white px-3 text-sm"
            >
              <option value="">Select…</option>
              {revisions.map((revision) => (
                <option key={revision.id} value={revision.id}>
                  v{revision.version} — {revision.savedByName}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader title={`${revisions.length} revisions`} description="Newest first." />

        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] text-sm">
            <thead>
              <tr className="border-ink-200 bg-ink-50 border-b text-left">
                <th
                  scope="col"
                  className="text-ink-500 px-4 py-2.5 text-xs font-semibold tracking-wide uppercase"
                >
                  Version
                </th>
                <th
                  scope="col"
                  className="text-ink-500 px-4 py-2.5 text-xs font-semibold tracking-wide uppercase"
                >
                  Status
                </th>
                <th
                  scope="col"
                  className="text-ink-500 px-4 py-2.5 text-xs font-semibold tracking-wide uppercase"
                >
                  Saved by
                </th>
                <th
                  scope="col"
                  className="text-ink-500 px-4 py-2.5 text-xs font-semibold tracking-wide uppercase"
                >
                  Saved at
                </th>
                <th
                  scope="col"
                  className="text-ink-500 px-4 py-2.5 text-xs font-semibold tracking-wide uppercase"
                >
                  Change summary
                </th>
                <th
                  scope="col"
                  className="text-ink-500 px-4 py-2.5 text-right text-xs font-semibold tracking-wide uppercase"
                >
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-ink-200 divide-y">
              {revisions.map((revision) => (
                <tr key={revision.id} className={revision.isCurrent ? 'bg-brand-50/50' : ''}>
                  <th scope="row" className="px-4 py-3 text-left font-normal">
                    <span className="text-ink-900 font-medium tabular-nums">
                      v{revision.version}
                    </span>
                    {revision.isCurrent ? (
                      <span className="bg-brand-100 text-brand-800 ml-2 rounded-full px-2 py-0.5 text-xs font-medium">
                        Current
                      </span>
                    ) : null}
                  </th>
                  <td className="text-ink-600 px-4 py-3">
                    {POST_STATUS_LABELS[revision.status as PostStatus] ?? revision.status}
                  </td>
                  <td className="text-ink-600 px-4 py-3">{revision.savedByName}</td>
                  <td className="text-ink-600 px-4 py-3 whitespace-nowrap">
                    {formatInTimezone(revision.createdAt, timezone)}
                  </td>
                  <td className="text-ink-600 max-w-xs px-4 py-3">
                    <span className="block truncate" title={revision.changeSummary ?? undefined}>
                      {revision.changeSummary ?? '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setPreviewId(revision.id)}
                      >
                        <Eye aria-hidden="true" className="h-4 w-4" />
                        Preview
                      </Button>
                      {mayRestore && !revision.isCurrent ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setRestoreTarget(revision)}
                        >
                          <Undo2 aria-hidden="true" className="h-4 w-4" />
                          Restore
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <RevisionPreviewDialog
        postId={post.id}
        revisionId={previewId}
        timezone={timezone}
        onClose={() => setPreviewId(null)}
      />

      <DiffDialog
        open={comparing}
        onClose={() => setComparing(false)}
        postId={post.id}
        leftId={leftId}
        rightId={rightId}
      />

      <ConfirmDialog
        open={restoreTarget !== null}
        onClose={() => setRestoreTarget(null)}
        onConfirm={() => void restore()}
        loading={restoring}
        tone="primary"
        confirmLabel={`Restore v${restoreTarget?.version ?? ''}`}
        title="Restore this version?"
        description={
          <>
            <p>
              The content of version {restoreTarget?.version} becomes the new version{' '}
              {post.version + 1}. Nothing in the history is deleted or rewritten.
            </p>
            <p className="mt-2">
              The post keeps its current status ({POST_STATUS_LABELS[post.status]}) — restoring
              content never republishes a post on its own.
            </p>
          </>
        }
      />
    </div>
  );
}

function RevisionPreviewDialog({
  postId,
  revisionId,
  timezone,
  onClose,
}: {
  postId: number;
  revisionId: number | null;
  timezone: string;
  onClose: () => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.posts.revision(postId, revisionId ?? 0),
    queryFn: () => api.get<RevisionDetail>(`/posts/${postId}/revisions/${revisionId}`),
    enabled: revisionId !== null,
  });

  return (
    <Dialog
      open={revisionId !== null}
      onClose={onClose}
      size="lg"
      title={data ? `Version ${data.version}` : 'Loading revision…'}
      description={
        data
          ? `Saved by ${data.savedByName} on ${formatInTimezone(data.createdAt, timezone)}`
          : undefined
      }
    >
      {isLoading || !data ? (
        <div className="space-y-2">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
        </div>
      ) : (
        <div>
          <h3 className="text-ink-900 text-lg font-semibold">{data.subject}</h3>
          <p className="text-ink-500 mt-1 text-xs">
            /{data.slug} · {POST_STATUS_LABELS[data.status as PostStatus] ?? data.status}
          </p>
          {data.excerpt ? (
            <p className="border-ink-300 text-ink-600 mt-3 border-l-2 pl-3 text-sm">
              {data.excerpt}
            </p>
          ) : null}
          <div className="border-ink-200 mt-4 border-t pt-4">
            <Markdown content={data.content} />
          </div>
        </div>
      )}
    </Dialog>
  );
}

function DiffDialog({
  open,
  onClose,
  postId,
  leftId,
  rightId,
}: {
  open: boolean;
  onClose: () => void;
  postId: number;
  leftId: number | null;
  rightId: number | null;
}) {
  const left = useQuery({
    queryKey: queryKeys.posts.revision(postId, leftId ?? 0),
    queryFn: () => api.get<RevisionDetail>(`/posts/${postId}/revisions/${leftId}`),
    enabled: open && leftId !== null,
  });

  const right = useQuery({
    queryKey: queryKeys.posts.revision(postId, rightId ?? 0),
    queryFn: () => api.get<RevisionDetail>(`/posts/${postId}/revisions/${rightId}`),
    enabled: open && rightId !== null,
  });

  const parts = React.useMemo(() => {
    if (!left.data || !right.data) return null;
    return diffLines(left.data.content, right.data.content);
  }, [left.data, right.data]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title="Compare versions"
      description={
        left.data && right.data
          ? `Version ${left.data.version} → version ${right.data.version}`
          : undefined
      }
    >
      {!parts ? (
        <div className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      ) : (
        <div className="space-y-4">
          {left.data && right.data && left.data.subject !== right.data.subject ? (
            <div className="border-ink-200 rounded-lg border p-3 text-sm">
              <p className="text-ink-800 font-medium">Subject changed</p>
              <p className="mt-1 text-red-700 line-through">{left.data.subject}</p>
              <p className="text-emerald-700">{right.data.subject}</p>
            </div>
          ) : null}

          <div className="border-ink-200 overflow-hidden rounded-lg border">
            <pre className="max-h-[26rem] overflow-auto bg-white p-0 text-xs leading-relaxed">
              {parts.map((part, index) => {
                const tone = part.added
                  ? 'bg-emerald-50 text-emerald-900'
                  : part.removed
                    ? 'bg-red-50 text-red-900'
                    : 'text-ink-600';
                const marker = part.added ? '+' : part.removed ? '-' : ' ';
                return (
                  <code key={index} className={`block px-3 py-0.5 whitespace-pre-wrap ${tone}`}>
                    {part.value
                      .split('\n')
                      .filter((line, lineIndex, all) => lineIndex < all.length - 1 || line !== '')
                      .map((line, lineIndex) => (
                        <span key={lineIndex} className="block">
                          <span aria-hidden="true" className="mr-2 opacity-60 select-none">
                            {marker}
                          </span>
                          {line || ' '}
                        </span>
                      ))}
                  </code>
                );
              })}
            </pre>
          </div>

          <p className="text-ink-500 text-xs">
            Lines prefixed <span className="font-mono">+</span> were added and{' '}
            <span className="font-mono">-</span> removed, so the difference is readable without
            relying on colour.
          </p>
        </div>
      )}
    </Dialog>
  );
}
