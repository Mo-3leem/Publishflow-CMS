'use client';

import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ImagePlus, Upload, X, Check } from 'lucide-react';
import { toast } from 'sonner';
import { api, apiList, ApiError } from '@/client/api-client';
import { queryKeys } from '@/client/query-keys';
import type { MediaDto } from '@/server/services/media-service';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Skeleton, EmptyState, Alert } from '@/components/ui/surfaces';
import { formatBytes } from '@/lib/utils';

/**
 * Image picker with inline upload.
 *
 * Used for post featured images and the site logo. Upload validation is entirely
 * server-side; the `accept` attribute here is a convenience, not a control.
 */
export function MediaPicker({
  value,
  onChange,
  label = 'Featured image',
  emptyLabel = 'No image selected',
}: {
  value: number | null;
  onChange: (mediaId: number | null) => void;
  label?: string;
  emptyLabel?: string;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <div className="space-y-2">
      <span className="text-ink-800 block text-sm font-medium">{label}</span>

      {value ? (
        <div className="border-ink-200 flex items-start gap-3 rounded-lg border bg-white p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/v1/media/${value}/file`}
            alt=""
            className="border-ink-200 h-16 w-16 shrink-0 rounded-md border object-cover"
          />
          <div className="min-w-0 flex-1">
            <p className="text-ink-700 text-sm">Image #{value} selected</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
                Change
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
                <X aria-hidden="true" className="h-3.5 w-3.5" />
                Remove
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="border-ink-300 hover:border-brand-400 hover:bg-brand-50/40 flex w-full items-center gap-3 rounded-lg border border-dashed bg-white px-3 py-4 text-left"
        >
          <span
            aria-hidden="true"
            className="bg-ink-100 text-ink-500 flex h-10 w-10 items-center justify-center rounded-lg"
          >
            <ImagePlus className="h-5 w-5" />
          </span>
          <span>
            <span className="text-ink-800 block text-sm font-medium">{emptyLabel}</span>
            <span className="text-ink-500 block text-xs">Choose from the library or upload</span>
          </span>
        </button>
      )}

      <MediaPickerDialog
        open={open}
        onClose={() => setOpen(false)}
        selected={value}
        onSelect={(id) => {
          onChange(id);
          setOpen(false);
        }}
      />
    </div>
  );
}

function MediaPickerDialog({
  open,
  onClose,
  selected,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  selected: number | null;
  onSelect: (id: number) => void;
}) {
  const queryClient = useQueryClient();
  const [uploading, setUploading] = React.useState(false);
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.media.list('picker'),
    queryFn: () => apiList<MediaDto>('/media?pageSize=48'),
    enabled: open,
  });

  const upload = async (file: File) => {
    setUploading(true);
    setUploadError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const asset = await api.upload<MediaDto>('/media', formData);
      await queryClient.invalidateQueries({ queryKey: queryKeys.media.all });
      toast.success('Image uploaded.');
      onSelect(asset.id);
    } catch (error) {
      setUploadError(
        error instanceof ApiError ? error.message : 'The upload failed. Please try again.',
      );
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Choose an image" size="lg">
      <div className="space-y-4">
        {uploadError ? <Alert tone="error">{uploadError}</Alert> : null}

        <div className="border-ink-300 bg-ink-50 flex flex-wrap items-center gap-3 rounded-lg border border-dashed p-3">
          <input
            ref={inputRef}
            id="media-upload"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
            }}
          />
          <Button
            type="button"
            variant="outline"
            loading={uploading}
            onClick={() => inputRef.current?.click()}
          >
            {!uploading ? <Upload aria-hidden="true" className="h-4 w-4" /> : null}
            {uploading ? 'Uploading…' : 'Upload image'}
          </Button>
          <p className="text-ink-500 text-xs">JPEG, PNG or WebP. SVG is not accepted.</p>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 8 }).map((_, index) => (
              <Skeleton key={index} className="aspect-square rounded-lg" />
            ))}
          </div>
        ) : !data || data.data.length === 0 ? (
          <EmptyState
            icon={ImagePlus}
            title="The library is empty"
            description="Upload an image to use it as a featured image or logo."
          />
        ) : (
          <ul className="grid max-h-96 grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-4">
            {data.data.map((asset) => (
              <li key={asset.id}>
                <button
                  type="button"
                  onClick={() => onSelect(asset.id)}
                  aria-pressed={selected === asset.id}
                  className={`group relative block w-full overflow-hidden rounded-lg border-2 text-left transition-colors ${
                    selected === asset.id
                      ? 'border-brand-600'
                      : 'border-ink-200 hover:border-brand-400'
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={asset.url}
                    alt={asset.altText ?? ''}
                    className="aspect-square w-full object-cover"
                    loading="lazy"
                  />
                  {selected === asset.id ? (
                    <span
                      aria-hidden="true"
                      className="bg-brand-600 absolute top-1.5 right-1.5 flex h-5 w-5 items-center justify-center rounded-full text-white"
                    >
                      <Check className="h-3 w-3" />
                    </span>
                  ) : null}
                  <span className="text-ink-600 block truncate bg-white px-2 py-1.5 text-xs">
                    {asset.originalName}
                    <span className="text-ink-400 block">
                      {asset.width}×{asset.height} · {formatBytes(asset.sizeBytes)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
