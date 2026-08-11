'use client';

import * as React from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, FolderTree, Search } from 'lucide-react';
import type { CategoryDto } from '@/server/services/category-service';
import { api, apiList, ApiError } from '@/client/api-client';
import { queryKeys } from '@/client/query-keys';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea, Select, Checkbox } from '@/components/ui/field';
import { Card, EmptyState, Alert, TableSkeleton } from '@/components/ui/surfaces';
import { Dialog, ConfirmDialog } from '@/components/ui/dialog';
import { normalizeSlug } from '@/lib/slug';

/**
 * Category management.
 *
 * Deletion is refused by the server while posts or child categories still
 * reference a row; the conflict detail is surfaced so the user is told which of
 * the two is blocking them.
 */

interface FormState {
  title: string;
  slug: string;
  description: string;
  parentId: number | '';
  isActive: boolean;
}

const EMPTY: FormState = { title: '', slug: '', description: '', parentId: '', isActive: true };

export function CategoriesManager({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = React.useState('');
  const [editing, setEditing] = React.useState<CategoryDto | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState<CategoryDto | null>(null);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.categories.all,
    queryFn: () => apiList<CategoryDto>('/categories'),
  });

  const categories = data?.data ?? [];

  const filtered = categories.filter((category) => {
    if (!search.trim()) return true;
    const needle = search.trim().toLowerCase();
    return (
      category.title.toLowerCase().includes(needle) || category.slug.toLowerCase().includes(needle)
    );
  });

  // Roots first, each followed by its children, so the tree reads top-down.
  const ordered: CategoryDto[] = [];
  for (const category of filtered.filter((c) => c.parentId === null)) {
    ordered.push(category);
    ordered.push(...filtered.filter((c) => c.parentId === category.id));
  }
  for (const category of filtered) {
    if (!ordered.includes(category)) ordered.push(category);
  }

  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/categories/${id}`),
    onSuccess: async () => {
      toast.success('Category deleted.');
      setDeleteTarget(null);
      setDeleteError(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.categories.all });
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError && error.code === 'RESOURCE_IN_USE') {
        const details = error.details as { posts?: number; childCategories?: number } | undefined;
        const reasons: string[] = [];
        if (details?.posts) reasons.push(`${details.posts} post(s)`);
        if (details?.childCategories) {
          reasons.push(
            `${details.childCategories} child categor${details.childCategories === 1 ? 'y' : 'ies'}`,
          );
        }
        setDeleteError(
          `This category is still referenced by ${reasons.join(' and ')}. Reassign them, or deactivate the category instead of deleting it.`,
        );
        return;
      }
      setDeleteError(error instanceof ApiError ? error.message : 'Could not delete this category.');
    },
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-ink-900 text-2xl font-bold tracking-tight">Categories</h1>
          <p className="text-ink-500 mt-1 text-sm">
            Used for public URLs and navigation. Nesting is limited to two levels.
          </p>
        </div>
        {canManage ? (
          <Button type="button" onClick={() => setCreating(true)}>
            <Plus aria-hidden="true" className="h-4 w-4" />
            New category
          </Button>
        ) : null}
      </div>

      <div className="relative max-w-sm">
        <label htmlFor="category-search" className="sr-only">
          Search categories
        </label>
        <Search
          aria-hidden="true"
          className="text-ink-400 pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
        />
        <Input
          id="category-search"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by title or slug…"
          className="pl-9"
        />
      </div>

      <Card className="overflow-hidden">
        {isError ? (
          <div className="p-5">
            <Alert tone="error">Could not load categories. Refresh to try again.</Alert>
          </div>
        ) : isLoading ? (
          <TableSkeleton rows={4} columns={5} />
        ) : ordered.length === 0 ? (
          <EmptyState
            icon={FolderTree}
            title={search ? 'No categories match your search' : 'No categories yet'}
            description={
              search
                ? 'Try a different term.'
                : 'Every post belongs to a category. Create the first one to start publishing.'
            }
            action={
              canManage && !search ? (
                <Button type="button" onClick={() => setCreating(true)}>
                  <Plus aria-hidden="true" className="h-4 w-4" />
                  New category
                </Button>
              ) : null
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] text-sm">
              <thead>
                <tr className="border-ink-200 bg-ink-50 border-b text-left">
                  <th
                    scope="col"
                    className="text-ink-500 px-4 py-2.5 text-xs font-semibold tracking-wide uppercase"
                  >
                    Title
                  </th>
                  <th
                    scope="col"
                    className="text-ink-500 px-4 py-2.5 text-xs font-semibold tracking-wide uppercase"
                  >
                    Slug
                  </th>
                  <th
                    scope="col"
                    className="text-ink-500 px-4 py-2.5 text-xs font-semibold tracking-wide uppercase"
                  >
                    Visibility
                  </th>
                  <th
                    scope="col"
                    className="text-ink-500 px-4 py-2.5 text-right text-xs font-semibold tracking-wide uppercase"
                  >
                    Posts
                  </th>
                  {canManage ? (
                    <th
                      scope="col"
                      className="text-ink-500 px-4 py-2.5 text-right text-xs font-semibold tracking-wide uppercase"
                    >
                      Actions
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody className="divide-ink-200 divide-y">
                {ordered.map((category) => (
                  <tr key={category.id} className="hover:bg-ink-50/60">
                    <th scope="row" className="px-4 py-3 text-left font-normal">
                      <span
                        className={
                          category.parentId ? 'text-ink-700 pl-5' : 'text-ink-900 font-medium'
                        }
                      >
                        {category.parentId ? (
                          <span aria-hidden="true" className="text-ink-300 mr-1.5">
                            └
                          </span>
                        ) : null}
                        {category.title}
                      </span>
                      {category.description ? (
                        <span className="text-ink-500 mt-0.5 block max-w-md truncate text-xs">
                          {category.description}
                        </span>
                      ) : null}
                    </th>
                    <td className="text-ink-500 px-4 py-3 font-mono text-xs">/{category.slug}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${
                          category.isActive
                            ? 'bg-emerald-50 text-emerald-800 ring-emerald-200'
                            : 'bg-ink-100 text-ink-600 ring-ink-200'
                        }`}
                      >
                        <span aria-hidden="true">{category.isActive ? '●' : '○'}</span>
                        {category.isActive ? 'Public' : 'Hidden'}
                      </span>
                    </td>
                    <td className="text-ink-600 px-4 py-3 text-right tabular-nums">
                      {category.postCount}
                    </td>
                    {canManage ? (
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setEditing(category)}
                          >
                            <Pencil aria-hidden="true" className="h-4 w-4" />
                            Edit
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-red-700 hover:bg-red-50"
                            onClick={() => {
                              setDeleteError(null);
                              setDeleteTarget(category);
                            }}
                          >
                            <Trash2 aria-hidden="true" className="h-4 w-4" />
                            <span className="sr-only">Delete {category.title}</span>
                          </Button>
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Mounted only while open, and keyed by target, so each opening starts
          from freshly initialised state rather than a reset effect. */}
      {creating ? (
        <CategoryDialog
          open
          onClose={() => setCreating(false)}
          categories={categories}
          mode="create"
        />
      ) : null}

      {editing ? (
        <CategoryDialog
          key={editing.id}
          open
          onClose={() => setEditing(null)}
          categories={categories}
          mode="edit"
          category={editing}
        />
      ) : null}

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => {
          setDeleteTarget(null);
          setDeleteError(null);
        }}
        onConfirm={() => deleteTarget && remove.mutate(deleteTarget.id)}
        loading={remove.isPending}
        title={`Delete “${deleteTarget?.title ?? ''}”?`}
        confirmLabel="Delete category"
        description={
          <>
            {deleteError ? (
              <Alert tone="error" className="mb-3">
                {deleteError}
              </Alert>
            ) : null}
            <p>
              Deleting is permanent and only possible while nothing references this category.
              {deleteTarget && deleteTarget.postCount > 0
                ? ` It currently has ${deleteTarget.postCount} post(s).`
                : ''}
            </p>
            <p className="mt-2">
              To hide a category from the public site without losing history, deactivate it instead.
            </p>
          </>
        }
      />
    </div>
  );
}

function CategoryDialog({
  open,
  onClose,
  categories,
  mode,
  category,
}: {
  open: boolean;
  onClose: () => void;
  categories: CategoryDto[];
  mode: 'create' | 'edit';
  category?: CategoryDto;
}) {
  const queryClient = useQueryClient();

  // State is initialised once from props. The caller remounts this component
  // with a `key` whenever the dialog opens or the target changes, so there is no
  // prop-to-state sync effect to go stale.
  const [form, setForm] = React.useState<FormState>(() =>
    category
      ? {
          title: category.title,
          slug: category.slug,
          description: category.description,
          parentId: category.parentId ?? '',
          isActive: category.isActive,
        }
      : EMPTY,
  );
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [slugTouched, setSlugTouched] = React.useState(mode === 'edit');

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        title: form.title.trim(),
        slug: form.slug.trim() || undefined,
        description: form.description.trim(),
        parentId: form.parentId === '' ? null : Number(form.parentId),
        isActive: form.isActive,
      };
      return mode === 'create'
        ? api.post<CategoryDto>('/categories', payload)
        : api.patch<CategoryDto>(`/categories/${category?.id}`, payload);
    },
    onSuccess: async () => {
      toast.success(mode === 'create' ? 'Category created.' : 'Category updated.');
      await queryClient.invalidateQueries({ queryKey: queryKeys.categories.all });
      onClose();
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError) {
        setErrors(
          Object.fromEntries(
            Object.entries(error.fieldErrors()).map(([key, message]) => [key, [message]]),
          ),
        );
        setFormError(Object.keys(error.fieldErrors()).length > 0 ? null : error.message);
      } else {
        setFormError('Could not save this category.');
      }
    },
  });

  // A category cannot be its own parent, and depth is capped at two levels, so
  // anything that already has a parent cannot become one.
  const parentOptions = categories.filter(
    (option) => option.id !== category?.id && option.parentId === null,
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={mode === 'create' ? 'New category' : `Edit “${category?.title ?? ''}”`}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            loading={save.isPending}
            onClick={() => save.mutate()}
            disabled={form.title.trim().length < 2}
          >
            {mode === 'create' ? 'Create category' : 'Save changes'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {formError ? <Alert tone="error">{formError}</Alert> : null}

        <Field label="Title" htmlFor="category-title" required error={errors.title}>
          <Input
            id="category-title"
            value={form.title}
            onChange={(event) => {
              const title = event.target.value;
              setForm((previous) => ({
                ...previous,
                title,
                slug: slugTouched ? previous.slug : normalizeSlug(title),
              }));
            }}
            maxLength={100}
            invalid={Boolean(errors.title)}
            placeholder="Engineering"
          />
        </Field>

        <Field
          label="Slug"
          htmlFor="category-slug"
          error={errors.slug}
          hint="Used in the public URL, e.g. /categories/engineering."
        >
          <Input
            id="category-slug"
            value={form.slug}
            onChange={(event) => {
              setSlugTouched(true);
              setForm((previous) => ({ ...previous, slug: event.target.value }));
            }}
            maxLength={120}
            invalid={Boolean(errors.slug)}
            placeholder="engineering"
          />
        </Field>

        <Field
          label="Description"
          htmlFor="category-description"
          error={errors.description}
          counter={`${form.description.length} / 2000`}
        >
          <Textarea
            id="category-description"
            value={form.description}
            onChange={(event) =>
              setForm((previous) => ({ ...previous, description: event.target.value }))
            }
            maxLength={2000}
            rows={3}
          />
        </Field>

        <Field
          label="Parent category"
          htmlFor="category-parent"
          error={errors.parentId}
          hint="Optional. Only top-level categories can be parents (two-level maximum)."
        >
          <Select
            id="category-parent"
            value={form.parentId}
            onChange={(event) =>
              setForm((previous) => ({
                ...previous,
                parentId: event.target.value === '' ? '' : Number(event.target.value),
              }))
            }
            invalid={Boolean(errors.parentId)}
          >
            <option value="">No parent (top level)</option>
            {parentOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.title}
              </option>
            ))}
          </Select>
        </Field>

        <Checkbox
          id="category-active"
          label="Visible on the public site"
          description="Hiding a category removes it from navigation and its public page, without touching existing posts."
          checked={form.isActive}
          onChange={(event) =>
            setForm((previous) => ({ ...previous, isActive: event.target.checked }))
          }
        />
      </div>
    </Dialog>
  );
}
