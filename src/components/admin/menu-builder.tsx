'use client';

import * as React from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Plus,
  Trash2,
  Pencil,
  ChevronUp,
  ChevronDown,
  IndentIncrease,
  IndentDecrease,
  Save,
  ListTree,
  TriangleAlert,
  Eye,
  EyeOff,
} from 'lucide-react';
import type { MenuDto, MenuItemDto } from '@/server/services/menu-service';
import type { CategoryDto } from '@/server/services/category-service';
import type { PostListItem } from '@/server/services/post-service';
import type { MenuItemType, MenuLocation } from '@/lib/domain';
import { api, apiList, ApiError } from '@/client/api-client';
import { queryKeys } from '@/client/query-keys';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Checkbox } from '@/components/ui/field';
import { Card, CardHeader, EmptyState, Alert, Skeleton } from '@/components/ui/surfaces';
import { Dialog, ConfirmDialog } from '@/components/ui/dialog';

/**
 * Header/footer menu builder.
 *
 * Ordering is edited locally as a flat list and saved in one atomic
 * `PUT /menus/:id/reorder` call — the server rejects the whole payload if any
 * part of it is invalid, so a half-applied order is impossible.
 *
 * Reordering uses buttons rather than drag-and-drop so it works from the
 * keyboard and with a screen reader. Drag-and-drop is listed as optional polish
 * in the specification; accessible controls are the requirement.
 */

interface FlatItem {
  id: number;
  parentId: number | null;
  title: string;
  itemType: MenuItemType;
  url: string | null;
  postId: number | null;
  categoryId: number | null;
  isVisible: boolean;
  openInNewTab: boolean;
  resolvedUrl: string | null;
  publicIssue: string | null;
}

/** Depth-first flatten so array order equals visual order. */
function flatten(items: MenuItemDto[], parentId: number | null = null): FlatItem[] {
  const output: FlatItem[] = [];
  for (const item of items) {
    output.push({
      id: item.id,
      parentId,
      title: item.title,
      itemType: item.itemType,
      url: item.url,
      postId: item.postId,
      categoryId: item.categoryId,
      isVisible: item.isVisible,
      openInNewTab: item.openInNewTab,
      resolvedUrl: item.resolvedUrl,
      publicIssue: item.publicIssue,
    });
    output.push(...flatten(item.children, item.id));
  }
  return output;
}

/** Convert the flat editing list back into `{id, parentId, position}` entries. */
function toReorderPayload(
  items: FlatItem[],
): Array<{ id: number; parentId: number | null; position: number }> {
  const counters = new Map<string, number>();
  return items.map((item) => {
    const key = String(item.parentId ?? 'root');
    const position = counters.get(key) ?? 0;
    counters.set(key, position + 1);
    return { id: item.id, parentId: item.parentId, position };
  });
}

export function MenuBuilder({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const [location, setLocation] = React.useState<MenuLocation>('HEADER');
  const [draft, setDraft] = React.useState<FlatItem[] | null>(null);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [editingItem, setEditingItem] = React.useState<FlatItem | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState<FlatItem | null>(null);

  const menusQuery = useQuery({
    queryKey: queryKeys.menus.all,
    queryFn: () => api.get<MenuDto[]>('/menus'),
  });

  const menu = menusQuery.data?.find((entry) => entry.location === location);
  const serverItems = React.useMemo(() => (menu ? flatten(menu.items) : []), [menu]);

  // Discard an unsaved draft when the selected menu changes or fresh server data
  // arrives. Done during render rather than in an effect: React applies the new
  // state before committing, so there is no flash of a stale ordering.
  const dataStamp = `${location}:${menusQuery.dataUpdatedAt}`;
  const [lastStamp, setLastStamp] = React.useState(dataStamp);
  if (lastStamp !== dataStamp) {
    setLastStamp(dataStamp);
    setDraft(null);
    setSaveError(null);
  }

  const items = draft ?? serverItems;
  const dirty = draft !== null;

  const reorder = useMutation({
    mutationFn: async () => {
      if (!menu) return;
      await api.put(`/menus/${menu.id}/reorder`, { items: toReorderPayload(items) });
    },
    onSuccess: async () => {
      toast.success('Menu order saved.');
      setDraft(null);
      setSaveError(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.menus.all });
    },
    onError: (error: unknown) => {
      setSaveError(
        error instanceof ApiError
          ? error.message
          : 'Could not save the menu order. Nothing was changed.',
      );
    },
  });

  const remove = useMutation({
    mutationFn: (itemId: number) => api.delete(`/menus/${menu?.id}/items/${itemId}`),
    onSuccess: async () => {
      toast.success('Menu item deleted.');
      setDeleteTarget(null);
      setDraft(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.menus.all });
    },
    onError: (error: unknown) => {
      toast.error(error instanceof ApiError ? error.message : 'Could not delete this item.');
    },
  });

  /** Swap an item with its previous/next sibling at the same depth. */
  const move = (index: number, direction: -1 | 1) => {
    const next = [...items];
    const item = next[index];
    if (!item) return;

    // Find the nearest neighbour sharing the same parent.
    let targetIndex = -1;
    for (let i = index + direction; i >= 0 && i < next.length; i += direction) {
      const candidate = next[i];
      if (!candidate) break;
      if (candidate.parentId === item.parentId) {
        targetIndex = i;
        break;
      }
    }
    if (targetIndex === -1) return;

    // Move the item together with its children so the subtree stays intact.
    const block = [item, ...next.filter((child) => child.parentId === item.id)];
    const targetItem = next[targetIndex];
    if (!targetItem) return;
    const targetBlock = [targetItem, ...next.filter((child) => child.parentId === targetItem.id)];

    const withoutBlocks = next.filter(
      (entry) => !block.includes(entry) && !targetBlock.includes(entry),
    );
    const insertAt = withoutBlocks.indexOf(
      direction === -1 ? (targetBlock[0] ?? item) : (block[0] ?? item),
    );

    const rebuilt =
      direction === -1
        ? [
            ...withoutBlocks.slice(0, Math.max(insertAt, 0)),
            ...block,
            ...targetBlock,
            ...withoutBlocks.slice(Math.max(insertAt, 0)),
          ]
        : [
            ...withoutBlocks.slice(0, Math.max(insertAt, 0)),
            ...targetBlock,
            ...block,
            ...withoutBlocks.slice(Math.max(insertAt, 0)),
          ];

    setDraft(rebuilt);
  };

  /** Nest an item under the closest preceding top-level sibling. */
  const indent = (index: number) => {
    const next = [...items];
    const item = next[index];
    if (!item || item.parentId !== null) return;
    // Items with children cannot be indented: that would exceed two levels.
    if (next.some((entry) => entry.parentId === item.id)) {
      toast.error('This item has children. Menus are limited to two levels.');
      return;
    }
    let previousRoot: FlatItem | null = null;
    for (let i = index - 1; i >= 0; i -= 1) {
      const candidate = next[i];
      if (candidate && candidate.parentId === null) {
        previousRoot = candidate;
        break;
      }
    }
    if (!previousRoot) return;
    next[index] = { ...item, parentId: previousRoot.id };
    setDraft(next);
  };

  const outdent = (index: number) => {
    const next = [...items];
    const item = next[index];
    if (!item || item.parentId === null) return;
    next[index] = { ...item, parentId: null };
    setDraft(next);
  };

  const depthOf = (item: FlatItem) => (item.parentId === null ? 0 : 1);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-ink-900 text-2xl font-bold tracking-tight">Menus</h1>
          <p className="text-ink-500 mt-1 text-sm">
            Header and footer navigation. Items pointing at unpublished or inactive targets are
            hidden from visitors automatically.
          </p>
        </div>
        {canManage && menu ? (
          <Button type="button" onClick={() => setAdding(true)}>
            <Plus aria-hidden="true" className="h-4 w-4" />
            Add item
          </Button>
        ) : null}
      </div>

      <div
        role="tablist"
        aria-label="Menu location"
        className="bg-ink-200/70 flex gap-1 rounded-lg p-1"
      >
        {(['HEADER', 'FOOTER'] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={location === value}
            onClick={() => setLocation(value)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              location === value
                ? 'text-ink-900 bg-white shadow-sm'
                : 'text-ink-600 hover:text-ink-900'
            }`}
          >
            {value === 'HEADER' ? 'Header menu' : 'Footer menu'}
          </button>
        ))}
      </div>

      {saveError ? <Alert tone="error">{saveError}</Alert> : null}

      {dirty ? (
        <Alert
          tone="warning"
          title="Unsaved order"
          action={
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                loading={reorder.isPending}
                onClick={() => reorder.mutate()}
              >
                <Save aria-hidden="true" className="h-4 w-4" />
                Save order
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setDraft(null)}>
                Discard
              </Button>
            </div>
          }
        >
          The new order is only stored once you save. It is applied atomically — if any part is
          invalid, nothing changes.
        </Alert>
      ) : null}

      <Card className="overflow-hidden">
        <CardHeader
          title={menu?.name ?? 'Menu'}
          description={`${items.length} item${items.length === 1 ? '' : 's'}`}
        />

        {menusQuery.isLoading ? (
          <div className="space-y-2 p-5">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : !menu ? (
          <div className="p-5">
            <Alert tone="error">This menu could not be loaded.</Alert>
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={ListTree}
            title="This menu is empty"
            description="Add links to categories, posts or custom URLs."
            action={
              canManage ? (
                <Button type="button" onClick={() => setAdding(true)}>
                  <Plus aria-hidden="true" className="h-4 w-4" />
                  Add item
                </Button>
              ) : null
            }
          />
        ) : (
          <ul className="divide-ink-200 divide-y">
            {items.map((item, index) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center gap-3 px-4 py-3"
                style={{ paddingLeft: `${1 + depthOf(item) * 1.75}rem` }}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-ink-900 font-medium">{item.title}</span>
                    <span className="bg-ink-100 text-ink-600 rounded px-1.5 py-0.5 text-xs font-medium">
                      {item.itemType.toLowerCase()}
                    </span>
                    {!item.isVisible ? (
                      <span className="bg-ink-100 text-ink-600 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs">
                        <EyeOff aria-hidden="true" className="h-3 w-3" />
                        Hidden
                      </span>
                    ) : null}
                  </div>

                  {item.publicIssue ? (
                    <p className="mt-1 inline-flex items-start gap-1.5 text-xs text-amber-800">
                      <TriangleAlert aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      {item.publicIssue}
                    </p>
                  ) : (
                    <p className="text-ink-400 mt-0.5 truncate font-mono text-xs">
                      {item.resolvedUrl ?? '—'}
                    </p>
                  )}
                </div>

                {canManage ? (
                  <div className="flex items-center gap-0.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Move ${item.title} up`}
                      onClick={() => move(index, -1)}
                    >
                      <ChevronUp aria-hidden="true" className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Move ${item.title} down`}
                      onClick={() => move(index, 1)}
                    >
                      <ChevronDown aria-hidden="true" className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Indent ${item.title}`}
                      disabled={item.parentId !== null}
                      onClick={() => indent(index)}
                    >
                      <IndentIncrease aria-hidden="true" className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Outdent ${item.title}`}
                      disabled={item.parentId === null}
                      onClick={() => outdent(index)}
                    >
                      <IndentDecrease aria-hidden="true" className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Edit ${item.title}`}
                      onClick={() => setEditingItem(item)}
                    >
                      <Pencil aria-hidden="true" className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${item.title}`}
                      className="text-red-700 hover:bg-red-50"
                      onClick={() => setDeleteTarget(item)}
                    >
                      <Trash2 aria-hidden="true" className="h-4 w-4" />
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Public preview"
          description="Exactly what visitors will see: items with an unreachable target are dropped."
        />
        <div className="p-5">
          {items.filter((item) => item.isVisible && item.resolvedUrl).length === 0 ? (
            <p className="text-ink-500 text-sm">Nothing in this menu is publicly visible yet.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {items
                .filter((item) => item.isVisible && item.resolvedUrl && item.parentId === null)
                .map((item) => (
                  <li key={item.id}>
                    <span className="border-ink-200 bg-ink-50 text-ink-700 inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm">
                      <Eye aria-hidden="true" className="text-ink-400 h-3.5 w-3.5" />
                      {item.title}
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </div>
      </Card>

      {/* Mounted only while open and keyed by target, so each opening starts
          from freshly initialised state. */}
      {menu && (adding || editingItem) ? (
        <MenuItemDialog
          key={editingItem ? `edit-${editingItem.id}` : 'new'}
          onClose={() => {
            setAdding(false);
            setEditingItem(null);
          }}
          menuId={menu.id}
          item={editingItem}
          parentOptions={items.filter((entry) => entry.parentId === null)}
        />
      ) : null}

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && remove.mutate(deleteTarget.id)}
        loading={remove.isPending}
        title={`Delete “${deleteTarget?.title ?? ''}”?`}
        confirmLabel="Delete item"
        description="Any items nested underneath it are deleted as well. The linked post or category itself is not affected."
      />
    </div>
  );
}

function MenuItemDialog({
  onClose,
  menuId,
  item,
  parentOptions,
}: {
  onClose: () => void;
  menuId: number;
  item: FlatItem | null;
  parentOptions: FlatItem[];
}) {
  const queryClient = useQueryClient();

  // Initialised once from `item`; the caller mounts this only while open and
  // keys it by target, so no prop-to-state sync effect is needed.
  const [title, setTitle] = React.useState(item?.title ?? '');
  const [itemType, setItemType] = React.useState<MenuItemType>(item?.itemType ?? 'CUSTOM');
  const [url, setUrl] = React.useState(item?.url ?? '');
  const [postId, setPostId] = React.useState<number | ''>(item?.postId ?? '');
  const [categoryId, setCategoryId] = React.useState<number | ''>(item?.categoryId ?? '');
  const [parentId, setParentId] = React.useState<number | ''>(item?.parentId ?? '');
  const [openInNewTab, setOpenInNewTab] = React.useState(item?.openInNewTab ?? false);
  const [isVisible, setIsVisible] = React.useState(item?.isVisible ?? true);
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});
  const [formError, setFormError] = React.useState<string | null>(null);

  const categories = useQuery({
    queryKey: queryKeys.categories.all,
    queryFn: () => apiList<CategoryDto>('/categories'),
  });

  const posts = useQuery({
    queryKey: queryKeys.posts.list('menu-picker'),
    queryFn: () =>
      apiList<PostListItem>('/posts?status=PUBLISHED&pageSize=100&sort=subject&order=asc'),
    enabled: itemType === 'POST',
  });

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        title: title.trim(),
        itemType,
        url: itemType === 'CUSTOM' ? url.trim() : null,
        postId: itemType === 'POST' ? Number(postId) : null,
        categoryId: itemType === 'CATEGORY' ? Number(categoryId) : null,
        parentId: parentId === '' ? null : Number(parentId),
        openInNewTab,
        isVisible,
      };
      return item
        ? api.patch(`/menus/${menuId}/items/${item.id}`, payload)
        : api.post(`/menus/${menuId}/items`, payload);
    },
    onSuccess: async () => {
      toast.success(item ? 'Menu item updated.' : 'Menu item added.');
      await queryClient.invalidateQueries({ queryKey: queryKeys.menus.all });
      onClose();
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError) {
        const fields = error.fieldErrors();
        setErrors(Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, [v]])));
        setFormError(Object.keys(fields).length > 0 ? null : error.message);
      } else {
        setFormError('Could not save this menu item.');
      }
    },
  });

  const targetReady =
    itemType === 'CUSTOM'
      ? url.trim().length > 0
      : itemType === 'POST'
        ? postId !== ''
        : categoryId !== '';

  return (
    <Dialog
      open
      onClose={onClose}
      title={item ? `Edit “${item.title}”` : 'Add menu item'}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            loading={save.isPending}
            disabled={title.trim().length === 0 || !targetReady}
            onClick={() => save.mutate()}
          >
            {item ? 'Save changes' : 'Add item'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {formError ? <Alert tone="error">{formError}</Alert> : null}

        <Field label="Label" htmlFor="menu-title" required error={errors.title}>
          <Input
            id="menu-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={100}
            invalid={Boolean(errors.title)}
            placeholder="Engineering"
          />
        </Field>

        <Field label="Link type" htmlFor="menu-type" required>
          <Select
            id="menu-type"
            value={itemType}
            onChange={(event) => setItemType(event.target.value as MenuItemType)}
          >
            <option value="CATEGORY">Category</option>
            <option value="POST">Post</option>
            <option value="CUSTOM">Custom URL</option>
          </Select>
        </Field>

        {itemType === 'CUSTOM' ? (
          <Field
            label="URL"
            htmlFor="menu-url"
            required
            error={errors.url}
            hint="An http(s) address, or an internal path starting with / such as /search."
          >
            <Input
              id="menu-url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              maxLength={2048}
              invalid={Boolean(errors.url)}
              placeholder="/about or https://example.com"
            />
          </Field>
        ) : itemType === 'CATEGORY' ? (
          <Field label="Category" htmlFor="menu-category" required error={errors.categoryId}>
            <Select
              id="menu-category"
              value={categoryId}
              onChange={(event) => setCategoryId(Number(event.target.value) || '')}
              invalid={Boolean(errors.categoryId)}
            >
              <option value="">Select a category…</option>
              {(categories.data?.data ?? []).map((category) => (
                <option key={category.id} value={category.id}>
                  {category.title}
                  {category.isActive ? '' : ' (inactive — hidden publicly)'}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <Field
            label="Post"
            htmlFor="menu-post"
            required
            error={errors.postId}
            hint="Only published posts appear in the public menu."
          >
            <Select
              id="menu-post"
              value={postId}
              onChange={(event) => setPostId(Number(event.target.value) || '')}
              invalid={Boolean(errors.postId)}
            >
              <option value="">{posts.isLoading ? 'Loading posts…' : 'Select a post…'}</option>
              {(posts.data?.data ?? []).map((post) => (
                <option key={post.id} value={post.id}>
                  {post.subject}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Field
          label="Parent item"
          htmlFor="menu-parent"
          error={errors.parentId}
          hint="Optional. Menus are limited to two levels."
        >
          <Select
            id="menu-parent"
            value={parentId}
            onChange={(event) => setParentId(Number(event.target.value) || '')}
            invalid={Boolean(errors.parentId)}
          >
            <option value="">No parent (top level)</option>
            {parentOptions
              .filter((option) => option.id !== item?.id)
              .map((option) => (
                <option key={option.id} value={option.id}>
                  {option.title}
                </option>
              ))}
          </Select>
        </Field>

        <Checkbox
          id="menu-visible"
          label="Visible"
          description="Hidden items stay configured but are not rendered on the public site."
          checked={isVisible}
          onChange={(event) => setIsVisible(event.target.checked)}
        />

        <Checkbox
          id="menu-new-tab"
          label="Open in a new tab"
          description="Recommended for external links only."
          checked={openInNewTab}
          onChange={(event) => setOpenInNewTab(event.target.checked)}
        />
      </div>
    </Dialog>
  );
}
