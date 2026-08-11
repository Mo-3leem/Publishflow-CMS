'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Save, History, ExternalLink, Trash2, RefreshCw } from 'lucide-react';
import type { PostDetail } from '@/server/services/post-service';
import type { CategoryDto } from '@/server/services/category-service';
import type { Principal } from '@/lib/domain';
import { can, canEditPost } from '@/lib/permissions';
import { normalizeSlug } from '@/lib/slug';
import { api, ApiError } from '@/client/api-client';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { Alert, Card, CardHeader } from '@/components/ui/surfaces';
import { ConfirmDialog } from '@/components/ui/dialog';
import { PostStatusBadge } from '@/components/ui/status-badge';
import { MarkdownEditor } from './markdown-editor';
import { MediaPicker } from './media-picker';
import { WorkflowActions } from './workflow-actions';
import { formatInTimezone } from '@/lib/datetime';

/**
 * Post create/edit screen.
 *
 * Two behaviours matter most here:
 *  - **Unsaved-change guard**: navigating away or reloading with edits pending
 *    prompts first.
 *  - **Conflict recovery**: on `409 VERSION_CONFLICT` the typed text is kept on
 *    screen and the user is offered a reload — input is never discarded.
 */

interface FormState {
  categoryId: number | '';
  subject: string;
  slug: string;
  excerpt: string;
  content: string;
  sourceUrl: string;
  featuredImageId: number | null;
  seoTitle: string;
  seoDescription: string;
  changeSummary: string;
}

function stateFromPost(post: PostDetail): FormState {
  return {
    categoryId: post.categoryId,
    subject: post.subject,
    slug: post.slug,
    excerpt: post.excerpt,
    content: post.content,
    sourceUrl: post.sourceUrl ?? '',
    featuredImageId: post.featuredImageId,
    seoTitle: post.seoTitle ?? '',
    seoDescription: post.seoDescription ?? '',
    changeSummary: '',
  };
}

function emptyState(categories: CategoryDto[]): FormState {
  return {
    categoryId: categories[0]?.id ?? '',
    subject: '',
    slug: '',
    excerpt: '',
    content: '',
    sourceUrl: '',
    featuredImageId: null,
    seoTitle: '',
    seoDescription: '',
    changeSummary: '',
  };
}

export interface PostEditorProps {
  mode: 'create' | 'edit';
  user: Principal;
  categories: CategoryDto[];
  timezone: string;
  post?: PostDetail;
}

export function PostEditor({ mode, user, categories, timezone, post }: PostEditorProps) {
  const router = useRouter();

  const [current, setCurrent] = React.useState<PostDetail | undefined>(post);
  const [baseline, setBaseline] = React.useState<FormState>(() =>
    post ? stateFromPost(post) : emptyState(categories),
  );
  const [form, setForm] = React.useState<FormState>(baseline);
  const [saving, setSaving] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [conflict, setConflict] = React.useState<{
    currentVersion: number;
    updatedAt: string;
  } | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});
  const [lastSavedAt, setLastSavedAt] = React.useState<string | null>(null);
  /** Author has edited the slug by hand — stop deriving it from the subject. */
  const [slugTouched, setSlugTouched] = React.useState(mode === 'edit');

  const editable =
    mode === 'create' ||
    (current ? canEditPost(user.role, user.id, current.authorId, current.status) : false);

  const dirty = React.useMemo(
    () =>
      (Object.keys(baseline) as Array<keyof FormState>).some(
        (key) => key !== 'changeSummary' && form[key] !== baseline[key],
      ),
    [form, baseline],
  );

  // Warn before a full page unload (reload / close tab).
  React.useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((previous) => ({ ...previous, [key]: value }));
  };

  const onSubjectChange = (value: string) => {
    setForm((previous) => ({
      ...previous,
      subject: value,
      // Only auto-derive the slug for a new post whose slug is still untouched.
      // A published slug must stay stable because external links depend on it.
      slug: !slugTouched && mode === 'create' ? normalizeSlug(value) : previous.slug,
    }));
  };

  const guardedNavigate = (href: string) => {
    if (dirty && !window.confirm('You have unsaved changes. Leave this page and discard them?')) {
      return;
    }
    router.push(href);
  };

  const save = async () => {
    setSaving(true);
    setFormError(null);
    setFieldErrors({});
    setConflict(null);

    try {
      if (mode === 'create') {
        const created = await api.post<PostDetail>('/posts', {
          categoryId: Number(form.categoryId),
          subject: form.subject.trim(),
          ...(form.slug.trim() ? { slug: form.slug.trim() } : {}),
          ...(form.excerpt.trim() ? { excerpt: form.excerpt.trim() } : {}),
          content: form.content,
          sourceUrl: form.sourceUrl.trim() || null,
          featuredImageId: form.featuredImageId,
          seoTitle: form.seoTitle.trim() || null,
          seoDescription: form.seoDescription.trim() || null,
        });
        toast.success('Draft created.');
        // Replace so the browser Back button does not return to the empty form.
        router.replace(`/admin/posts/${created.id}/edit`);
        router.refresh();
        return;
      }

      if (!current) return;

      const updated = await api.patch<PostDetail>(`/posts/${current.id}`, {
        expectedVersion: current.version,
        categoryId: Number(form.categoryId),
        subject: form.subject.trim(),
        slug: form.slug.trim(),
        excerpt: form.excerpt,
        content: form.content,
        sourceUrl: form.sourceUrl.trim() || null,
        featuredImageId: form.featuredImageId,
        seoTitle: form.seoTitle.trim() || null,
        seoDescription: form.seoDescription.trim() || null,
        ...(form.changeSummary.trim() ? { changeSummary: form.changeSummary.trim() } : {}),
      });

      setCurrent(updated);
      const next = stateFromPost(updated);
      setBaseline(next);
      setForm(next);
      setLastSavedAt(updated.updatedAt);
      toast.success(`Saved as version ${updated.version}.`);
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError) {
        setFieldErrors(
          Object.fromEntries(
            Object.entries(error.fieldErrors()).map(([key, message]) => [key, [message]]),
          ),
        );

        if (error.code === 'VERSION_CONFLICT') {
          const details = error.details as
            { currentVersion?: number; updatedAt?: string } | undefined;
          // Deliberately does NOT touch `form`: the user's typing survives.
          setConflict({
            currentVersion: details?.currentVersion ?? 0,
            updatedAt: details?.updatedAt ?? '',
          });
        } else {
          setFormError(error.message);
        }
      } else {
        setFormError('Could not save. Check your connection and try again.');
      }
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!current) return;
    setDeleting(true);
    try {
      await api.delete(`/posts/${current.id}`, { expectedVersion: current.version });
      toast.success('Post deleted.');
      router.push('/admin/posts');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not delete this post.');
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const onWorkflowSuccess = (updated: PostDetail) => {
    setCurrent(updated);
    const next = stateFromPost(updated);
    setBaseline(next);
    setForm(next);
    router.refresh();
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-ink-900 text-2xl font-bold tracking-tight">
            {mode === 'create' ? 'New post' : 'Edit post'}
          </h1>
          <div className="text-ink-500 mt-2 flex flex-wrap items-center gap-2 text-sm">
            {current ? <PostStatusBadge status={current.status} /> : null}
            {current ? (
              <>
                <span className="bg-ink-100 text-ink-700 rounded-md px-2 py-0.5 text-xs font-medium tabular-nums">
                  Version {current.version}
                </span>
                <span>
                  Last saved {formatInTimezone(lastSavedAt ?? current.updatedAt, timezone)}
                </span>
              </>
            ) : (
              <span>Saving creates version 1 and its first revision.</span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {current ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => guardedNavigate(`/admin/posts/${current.id}/revisions`)}
              >
                <History aria-hidden="true" className="h-4 w-4" />
                Revisions
              </Button>
              {current.status === 'PUBLISHED' ? (
                <Link
                  href={`/posts/${current.slug}`}
                  target="_blank"
                  className="border-ink-300 text-ink-800 hover:bg-ink-50 inline-flex h-8 items-center gap-1.5 rounded-lg border bg-white px-3 text-sm font-medium"
                >
                  <ExternalLink aria-hidden="true" className="h-4 w-4" />
                  View live
                </Link>
              ) : null}
              {can(user.role, 'post.delete') ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmDelete(true)}
                  className="text-red-700 hover:bg-red-50"
                >
                  <Trash2 aria-hidden="true" className="h-4 w-4" />
                  Delete
                </Button>
              ) : null}
            </>
          ) : null}
        </div>
      </div>

      {conflict ? (
        <Alert
          tone="error"
          title="This post was changed by someone else"
          action={
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" onClick={() => router.refresh()}>
                <RefreshCw aria-hidden="true" className="h-4 w-4" />
                Reload the latest version
              </Button>
              {current ? (
                <Link
                  href={`/admin/posts/${current.id}/revisions`}
                  className="inline-flex h-8 items-center rounded-lg border border-red-300 bg-white px-3 text-sm font-medium text-red-800 hover:bg-red-50"
                >
                  Compare revisions
                </Link>
              ) : null}
            </div>
          }
        >
          <p>
            Your copy is version {current?.version}; the server now has version{' '}
            {conflict.currentVersion}
            {conflict.updatedAt
              ? `, updated ${formatInTimezone(conflict.updatedAt, timezone)}`
              : ''}
            . Nothing was overwritten.
          </p>
          <p className="mt-1 font-medium">
            Your unsaved text is still on this page — copy anything you need before reloading.
          </p>
        </Alert>
      ) : null}

      {formError ? <Alert tone="error">{formError}</Alert> : null}

      {!editable && current ? (
        <Alert tone="warning" title="Read only">
          {current.authorId === user.id
            ? `You can only edit your own posts while they are drafts. This post is ${current.status.replace('_', ' ').toLowerCase()}.`
            : 'Only editors and administrators can edit posts written by someone else.'}
        </Alert>
      ) : null}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
        className="grid gap-5 lg:grid-cols-3"
      >
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader title="Content" />
            <div className="space-y-4 p-5">
              <Field
                label="Subject"
                htmlFor="subject"
                required
                error={fieldErrors.subject}
                counter={`${form.subject.length} / 200`}
              >
                <Input
                  id="subject"
                  value={form.subject}
                  onChange={(event) => onSubjectChange(event.target.value)}
                  maxLength={200}
                  disabled={!editable}
                  invalid={Boolean(fieldErrors.subject)}
                  placeholder="How our editorial workflow works"
                />
              </Field>

              <Field
                label="Slug"
                htmlFor="slug"
                error={fieldErrors.slug}
                hint={
                  current?.status === 'PUBLISHED'
                    ? 'This post is live. Changing the slug breaks existing links to it.'
                    : 'Used in the public URL. Leave blank to generate one from the subject.'
                }
              >
                <div className="flex items-center gap-2">
                  <span className="text-ink-400 shrink-0 text-sm">/posts/</span>
                  <Input
                    id="slug"
                    value={form.slug}
                    onChange={(event) => {
                      setSlugTouched(true);
                      update('slug', event.target.value);
                    }}
                    maxLength={220}
                    disabled={!editable}
                    invalid={Boolean(fieldErrors.slug)}
                    placeholder="how-our-editorial-workflow-works"
                  />
                </div>
              </Field>

              <Field
                label="Summary"
                htmlFor="excerpt"
                error={fieldErrors.excerpt}
                hint="Shown on cards and in search results. Generated from the content if left blank."
                counter={`${form.excerpt.length} / 500`}
              >
                <Textarea
                  id="excerpt"
                  value={form.excerpt}
                  onChange={(event) => update('excerpt', event.target.value)}
                  maxLength={500}
                  rows={3}
                  disabled={!editable}
                  invalid={Boolean(fieldErrors.excerpt)}
                />
              </Field>

              <div className="space-y-1.5">
                <span className="flex items-baseline">
                  <label htmlFor="content" className="text-ink-800 block text-sm font-medium">
                    Content
                  </label>
                  <span className="ml-0.5 text-red-600" aria-hidden="true">
                    *
                  </span>
                </span>
                {editable ? (
                  <MarkdownEditor
                    id="content"
                    value={form.content}
                    onChange={(value) => update('content', value)}
                    invalid={Boolean(fieldErrors.content)}
                    placeholder={'## Introduction\n\nStart writing…'}
                  />
                ) : (
                  <Textarea id="content" value={form.content} rows={16} disabled readOnly />
                )}
                {fieldErrors.content ? (
                  <p className="text-xs text-red-700">{fieldErrors.content[0]}</p>
                ) : null}
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Search engine optimisation"
              description="Falls back to the subject, summary and site defaults when blank."
            />
            <div className="space-y-4 p-5">
              <Field
                label="SEO title"
                htmlFor="seoTitle"
                error={fieldErrors.seoTitle}
                hint="Around 60 characters reads best in search results."
                counter={`${form.seoTitle.length} / 120`}
              >
                <Input
                  id="seoTitle"
                  value={form.seoTitle}
                  onChange={(event) => update('seoTitle', event.target.value)}
                  maxLength={120}
                  disabled={!editable}
                />
              </Field>

              <Field
                label="SEO description"
                htmlFor="seoDescription"
                error={fieldErrors.seoDescription}
                hint="Around 160 characters reads best in search results."
                counter={`${form.seoDescription.length} / 300`}
              >
                <Textarea
                  id="seoDescription"
                  value={form.seoDescription}
                  onChange={(event) => update('seoDescription', event.target.value)}
                  maxLength={300}
                  rows={3}
                  disabled={!editable}
                />
              </Field>
            </div>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Publishing" />
            <div className="space-y-4 p-5">
              {current ? (
                <WorkflowActions
                  post={current}
                  user={user}
                  timezone={timezone}
                  dirty={dirty}
                  onSuccess={onWorkflowSuccess}
                />
              ) : (
                <p className="text-ink-500 text-sm">
                  Save the draft first. Workflow actions become available afterwards.
                </p>
              )}

              <div className="border-ink-200 border-t pt-4">
                {mode === 'edit' ? (
                  <Field
                    label="Change summary"
                    htmlFor="changeSummary"
                    hint="Optional note stored with this revision."
                    className="mb-3"
                  >
                    <Input
                      id="changeSummary"
                      value={form.changeSummary}
                      onChange={(event) => update('changeSummary', event.target.value)}
                      maxLength={300}
                      disabled={!editable}
                      placeholder="Clarified the second section"
                    />
                  </Field>
                ) : null}

                <Button
                  type="submit"
                  className="w-full"
                  loading={saving}
                  disabled={!editable || (mode === 'edit' && !dirty)}
                >
                  {!saving ? <Save aria-hidden="true" className="h-4 w-4" /> : null}
                  {mode === 'create' ? 'Create draft' : dirty ? 'Save changes' : 'No changes'}
                </Button>

                {dirty ? (
                  <p className="mt-2 text-center text-xs text-amber-700" role="status">
                    You have unsaved changes.
                  </p>
                ) : null}
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Organisation" />
            <div className="space-y-4 p-5">
              <Field label="Category" htmlFor="categoryId" required error={fieldErrors.categoryId}>
                <Select
                  id="categoryId"
                  value={form.categoryId}
                  onChange={(event) => update('categoryId', Number(event.target.value))}
                  disabled={!editable}
                  invalid={Boolean(fieldErrors.categoryId)}
                >
                  {categories.length === 0 ? (
                    <option value="">No categories exist yet</option>
                  ) : null}
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.title}
                      {category.isActive ? '' : ' (inactive)'}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field
                label="Source URL"
                htmlFor="sourceUrl"
                error={fieldErrors.sourceUrl}
                hint="Optional. Must be a complete http:// or https:// address."
              >
                <Input
                  id="sourceUrl"
                  type="url"
                  value={form.sourceUrl}
                  onChange={(event) => update('sourceUrl', event.target.value)}
                  disabled={!editable}
                  invalid={Boolean(fieldErrors.sourceUrl)}
                  placeholder="https://example.com/original-article"
                />
              </Field>

              <MediaPicker
                value={form.featuredImageId}
                onChange={(value) => update('featuredImageId', value)}
              />
            </div>
          </Card>

          {current ? (
            <Card>
              <CardHeader title="Details" />
              <dl className="divide-ink-200 divide-y text-sm">
                <div className="flex justify-between gap-3 px-5 py-2.5">
                  <dt className="text-ink-500">Author</dt>
                  <dd className="text-ink-800 font-medium">{current.authorName}</dd>
                </div>
                <div className="flex justify-between gap-3 px-5 py-2.5">
                  <dt className="text-ink-500">Reads</dt>
                  <dd className="text-ink-800 font-medium tabular-nums">{current.readsCount}</dd>
                </div>
                <div className="flex justify-between gap-3 px-5 py-2.5">
                  <dt className="text-ink-500">Created</dt>
                  <dd className="text-ink-800">{formatInTimezone(current.createdAt, timezone)}</dd>
                </div>
                {current.publishedAt ? (
                  <div className="flex justify-between gap-3 px-5 py-2.5">
                    <dt className="text-ink-500">Published</dt>
                    <dd className="text-ink-800">
                      {formatInTimezone(current.publishedAt, timezone)}
                    </dd>
                  </div>
                ) : null}
                {current.scheduledAt ? (
                  <div className="flex justify-between gap-3 px-5 py-2.5">
                    <dt className="text-ink-500">Scheduled</dt>
                    <dd className="text-ink-800">
                      {formatInTimezone(current.scheduledAt, timezone)}
                    </dd>
                  </div>
                ) : null}
              </dl>
            </Card>
          ) : null}
        </div>
      </form>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => void remove()}
        loading={deleting}
        title="Delete this post?"
        confirmLabel="Delete post"
        description={
          <>
            <p>
              The post is removed from every listing and from the public site. Its revisions and
              audit history are kept, and its slug stays reserved so old links cannot be taken over.
            </p>
            <p className="text-ink-800 mt-2 font-medium">
              This cannot be undone from the interface.
            </p>
          </>
        }
      />
    </div>
  );
}
