'use client';

import * as React from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Upload, Trash2, Pencil, ImageIcon, LayoutGrid, List } from 'lucide-react';
import type { MediaDto } from '@/server/services/media-service';
import type { Principal } from '@/lib/domain';
import { can, canEditMedia } from '@/lib/permissions';
import { api, apiList, ApiError } from '@/client/api-client';
import { queryKeys } from '@/client/query-keys';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { Card, EmptyState, Alert, Skeleton } from '@/components/ui/surfaces';
import { Dialog, ConfirmDialog } from '@/components/ui/dialog';
import { formatBytes } from '@/lib/utils';
import { formatInTimezone } from '@/lib/datetime';

/**
 * Media library.
 *
 * The upload control is a convenience: all validation (magic bytes, decode,
 * size, allow-list) happens server-side, so bypassing the `accept` attribute
 * changes nothing.
 */
export function MediaLibrary({
  user,
  timezone,
  maxUploadBytes,
}: {
  user: Principal;
  timezone: string;
  maxUploadBytes: number;
}) {
  const queryClient = useQueryClient();
  const [page, setPage] = React.useState(1);
  const [view, setView] = React.useState<'grid' | 'list'>('grid');
  const [uploading, setUploading] = React.useState(false);
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<MediaDto | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<MediaDto | null>(null);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.media.list(String(page)),
    queryFn: () => apiList<MediaDto>(`/media?page=${page}&pageSize=24`),
  });

  const upload = async (files: FileList) => {
    setUploading(true);
    setUploadError(null);
    let succeeded = 0;

    for (const file of Array.from(files)) {
      try {
        const formData = new FormData();
        formData.append('file', file);
        await api.upload<MediaDto>('/media', formData);
        succeeded += 1;
      } catch (error) {
        setUploadError(
          error instanceof ApiError
            ? `${file.name}: ${error.message}`
            : `${file.name}: the upload failed.`,
        );
      }
    }

    if (succeeded > 0) {
      toast.success(`${succeeded} image${succeeded === 1 ? '' : 's'} uploaded.`);
      await queryClient.invalidateQueries({ queryKey: queryKeys.media.all });
    }
    setUploading(false);
    if (inputRef.current) inputRef.current.value = '';
  };

  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/media/${id}`),
    onSuccess: async () => {
      toast.success('Image deleted.');
      setDeleteTarget(null);
      setDeleteError(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.media.all });
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError && error.code === 'RESOURCE_IN_USE') {
        const details = error.details as { posts?: number; settings?: number } | undefined;
        const parts: string[] = [];
        if (details?.posts) parts.push(`${details.posts} post(s)`);
        if (details?.settings) parts.push('the site logo');
        setDeleteError(
          `This image is still used by ${parts.join(' and ')}. Remove those references first.`,
        );
        return;
      }
      setDeleteError(error instanceof ApiError ? error.message : 'Could not delete this image.');
    },
  });

  const assets = data?.data ?? [];
  const canDelete = can(user.role, 'media.manageAll');
  const maxMb = Math.floor(maxUploadBytes / (1024 * 1024));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-ink-900 text-2xl font-bold tracking-tight">Media</h1>
          <p className="text-ink-500 mt-1 text-sm">
            JPEG, PNG and WebP up to {maxMb} MB. SVG is rejected because it can carry scripts.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div role="group" aria-label="View mode" className="bg-ink-200/70 flex rounded-lg p-0.5">
            <button
              type="button"
              onClick={() => setView('grid')}
              aria-pressed={view === 'grid'}
              aria-label="Grid view"
              className={`rounded-md p-1.5 ${view === 'grid' ? 'bg-white shadow-sm' : 'text-ink-600'}`}
            >
              <LayoutGrid aria-hidden="true" className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setView('list')}
              aria-pressed={view === 'list'}
              aria-label="List view"
              className={`rounded-md p-1.5 ${view === 'list' ? 'bg-white shadow-sm' : 'text-ink-600'}`}
            >
              <List aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>

          <input
            ref={inputRef}
            id="library-upload"
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={(event) => {
              if (event.target.files?.length) void upload(event.target.files);
            }}
          />
          <Button type="button" loading={uploading} onClick={() => inputRef.current?.click()}>
            {!uploading ? <Upload aria-hidden="true" className="h-4 w-4" /> : null}
            {uploading ? 'Uploading…' : 'Upload'}
          </Button>
        </div>
      </div>

      {uploadError ? <Alert tone="error">{uploadError}</Alert> : null}

      <Card className="overflow-hidden">
        {isError ? (
          <div className="p-5">
            <Alert tone="error">Could not load the media library.</Alert>
          </div>
        ) : isLoading ? (
          <div className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, index) => (
              <Skeleton key={index} className="aspect-square rounded-lg" />
            ))}
          </div>
        ) : assets.length === 0 ? (
          <EmptyState
            icon={ImageIcon}
            title="No images yet"
            description="Upload an image to use it as a post featured image or the site logo."
            action={
              <Button type="button" onClick={() => inputRef.current?.click()}>
                <Upload aria-hidden="true" className="h-4 w-4" />
                Upload
              </Button>
            }
          />
        ) : view === 'grid' ? (
          <ul className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-3 lg:grid-cols-4">
            {assets.map((asset) => (
              <li key={asset.id} className="border-ink-200 overflow-hidden rounded-lg border">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={asset.url}
                  alt={asset.altText ?? ''}
                  className="bg-ink-50 aspect-square w-full object-cover"
                  loading="lazy"
                />
                <div className="p-2.5">
                  <p
                    className="text-ink-800 truncate text-sm font-medium"
                    title={asset.originalName}
                  >
                    {asset.originalName}
                  </p>
                  <p className="text-ink-500 text-xs">
                    {asset.width}×{asset.height} · {formatBytes(asset.sizeBytes)}
                  </p>
                  <p className="text-ink-400 mt-0.5 truncate text-xs">
                    {asset.altText ? `Alt: ${asset.altText}` : 'No alt text'}
                  </p>
                  <div className="mt-2 flex gap-1">
                    {canEditMedia(user.role, user.id, asset.uploadedBy) ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditing(asset)}
                      >
                        <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
                        Alt text
                      </Button>
                    ) : null}
                    {canDelete ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-red-700 hover:bg-red-50"
                        onClick={() => {
                          setDeleteError(null);
                          setDeleteTarget(asset);
                        }}
                      >
                        <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                        <span className="sr-only">Delete {asset.originalName}</span>
                      </Button>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] text-sm">
              <thead>
                <tr className="border-ink-200 bg-ink-50 border-b text-left">
                  <th
                    scope="col"
                    className="text-ink-500 px-4 py-2.5 text-xs font-semibold tracking-wide uppercase"
                  >
                    Image
                  </th>
                  <th
                    scope="col"
                    className="text-ink-500 px-4 py-2.5 text-xs font-semibold tracking-wide uppercase"
                  >
                    Alt text
                  </th>
                  <th
                    scope="col"
                    className="text-ink-500 px-4 py-2.5 text-xs font-semibold tracking-wide uppercase"
                  >
                    Dimensions
                  </th>
                  <th
                    scope="col"
                    className="text-ink-500 px-4 py-2.5 text-xs font-semibold tracking-wide uppercase"
                  >
                    Uploaded by
                  </th>
                  <th
                    scope="col"
                    className="text-ink-500 px-4 py-2.5 text-xs font-semibold tracking-wide uppercase"
                  >
                    Date
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
                {assets.map((asset) => (
                  <tr key={asset.id} className="hover:bg-ink-50/60">
                    <th scope="row" className="px-4 py-2.5 text-left font-normal">
                      <div className="flex items-center gap-3">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={asset.url}
                          alt=""
                          className="border-ink-200 h-10 w-10 shrink-0 rounded border object-cover"
                          loading="lazy"
                        />
                        <span className="min-w-0">
                          <span className="text-ink-900 block truncate font-medium">
                            {asset.originalName}
                          </span>
                          <span className="text-ink-500 block text-xs">
                            {formatBytes(asset.sizeBytes)} · {asset.mimeType}
                          </span>
                        </span>
                      </div>
                    </th>
                    <td className="text-ink-600 max-w-xs px-4 py-2.5">
                      <span className="block truncate">{asset.altText ?? '—'}</span>
                    </td>
                    <td className="text-ink-600 px-4 py-2.5 whitespace-nowrap">
                      {asset.width}×{asset.height}
                    </td>
                    <td className="text-ink-600 px-4 py-2.5">{asset.uploadedByName}</td>
                    <td className="text-ink-600 px-4 py-2.5 whitespace-nowrap">
                      {formatInTimezone(asset.createdAt, timezone)}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end gap-1">
                        {canEditMedia(user.role, user.id, asset.uploadedBy) ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setEditing(asset)}
                          >
                            <Pencil aria-hidden="true" className="h-4 w-4" />
                          </Button>
                        ) : null}
                        {canDelete ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-red-700 hover:bg-red-50"
                            onClick={() => {
                              setDeleteError(null);
                              setDeleteTarget(asset);
                            }}
                          >
                            <Trash2 aria-hidden="true" className="h-4 w-4" />
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data && data.meta.totalPages > 1 ? (
          <nav
            aria-label="Media pagination"
            className="border-ink-200 flex items-center justify-between gap-3 border-t px-5 py-3"
          >
            <p className="text-ink-500 text-xs">
              Page {data.meta.page} of {data.meta.totalPages} · {data.meta.total} images
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
              >
                Previous
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={page >= data.meta.totalPages}
                onClick={() => setPage((value) => value + 1)}
              >
                Next
              </Button>
            </div>
          </nav>
        ) : null}
      </Card>

      {editing ? (
        <AltTextDialog key={editing.id} asset={editing} onClose={() => setEditing(null)} />
      ) : null}

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => {
          setDeleteTarget(null);
          setDeleteError(null);
        }}
        onConfirm={() => deleteTarget && remove.mutate(deleteTarget.id)}
        loading={remove.isPending}
        title="Delete this image?"
        confirmLabel="Delete image"
        description={
          <>
            {deleteError ? (
              <Alert tone="error" className="mb-3">
                {deleteError}
              </Alert>
            ) : null}
            <p>
              The file is removed from disk. Deletion is refused while a post or the site logo still
              references it.
            </p>
          </>
        }
      />
    </div>
  );
}

/** Mounted per asset (keyed at the call site), so state initialises fresh. */
function AltTextDialog({ asset, onClose }: { asset: MediaDto; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [altText, setAltText] = React.useState(asset.altText ?? '');
  const [error, setError] = React.useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => api.patch(`/media/${asset.id}`, { altText: altText.trim() || null }),
    onSuccess: async () => {
      toast.success('Alt text saved.');
      await queryClient.invalidateQueries({ queryKey: queryKeys.media.all });
      onClose();
    },
    onError: (caught: unknown) => {
      setError(caught instanceof ApiError ? caught.message : 'Could not save the alt text.');
    },
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title="Edit alt text"
      description="Describe the image for people using a screen reader. Leave blank for purely decorative images."
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error ? <Alert tone="error">{error}</Alert> : null}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={asset.url}
          alt={asset.altText ?? ''}
          className="border-ink-200 max-h-56 w-full rounded-lg border object-contain"
        />
        <Field label="Alt text" htmlFor="alt-text" counter={`${altText.length} / 300`}>
          <Input
            id="alt-text"
            value={altText}
            onChange={(event) => setAltText(event.target.value)}
            maxLength={300}
            placeholder="A diagram showing the draft, review and publish states"
          />
        </Field>
      </div>
    </Dialog>
  );
}
