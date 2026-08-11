import 'server-only';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { getDb, type Db } from '@/server/db';
import { categories, menuItems, menus, posts } from '@/server/db/schema';
import { nowIso } from '@/lib/datetime';
import { can } from '@/lib/permissions';
import { isSafeLinkTarget } from '@/lib/url-safety';
import { describeTreeError, validateTree, validateReparent, type TreeNode } from '@/lib/tree';
import type { MenuItemType, MenuLocation, Principal } from '@/lib/domain';
import { AppError } from '@/server/errors/app-error';
import { writeAudit } from './audit-service';
import type { ActorContext } from './context';

/**
 * Navigation menus.
 *
 * Two tables (menus + menu_items) rather than the single flat NavMenu of the
 * original brief, because one table cannot express locations, nesting, ordering
 * and typed targets at the same time.
 */

export interface MenuItemDto {
  id: number;
  menuId: number;
  parentId: number | null;
  title: string;
  itemType: MenuItemType;
  url: string | null;
  postId: number | null;
  categoryId: number | null;
  position: number;
  openInNewTab: boolean;
  isVisible: boolean;
  /** Resolved href for preview/public rendering; null when the target is gone. */
  resolvedUrl: string | null;
  /** Why the item would be hidden publicly, for the admin builder. */
  publicIssue: string | null;
  children: MenuItemDto[];
}

export interface MenuDto {
  id: number;
  name: string;
  location: MenuLocation;
  isActive: boolean;
  items: MenuItemDto[];
}

function requireMenuManager(actor: Principal): void {
  if (!can(actor.role, 'menu.manage')) {
    throw AppError.forbidden('Only administrators and editors can manage menus.');
  }
}

interface RawItem {
  id: number;
  menuId: number;
  parentId: number | null;
  title: string;
  itemType: MenuItemType;
  url: string | null;
  postId: number | null;
  categoryId: number | null;
  position: number;
  openInNewTab: number;
  isVisible: number;
}

/**
 * Load a menu's items and resolve every target in three queries total
 * (items + referenced posts + referenced categories) rather than one per item.
 */
function loadItems(db: Db, menuId: number): RawItem[] {
  return db
    .select({
      id: menuItems.id,
      menuId: menuItems.menuId,
      parentId: menuItems.parentId,
      title: menuItems.title,
      itemType: menuItems.itemType,
      url: menuItems.url,
      postId: menuItems.postId,
      categoryId: menuItems.categoryId,
      position: menuItems.position,
      openInNewTab: menuItems.openInNewTab,
      isVisible: menuItems.isVisible,
    })
    .from(menuItems)
    .where(eq(menuItems.menuId, menuId))
    .orderBy(asc(menuItems.position), asc(menuItems.id))
    .all();
}

interface Resolution {
  url: string | null;
  issue: string | null;
}

function resolveTargets(db: Db, items: RawItem[], now: string): Map<number, Resolution> {
  const postIds = [
    ...new Set(items.filter((i) => i.postId != null).map((i) => i.postId as number)),
  ];
  const categoryIds = [
    ...new Set(items.filter((i) => i.categoryId != null).map((i) => i.categoryId as number)),
  ];

  const postRows = postIds.length
    ? db
        .select({
          id: posts.id,
          slug: posts.slug,
          status: posts.status,
          publishedAt: posts.publishedAt,
          deletedAt: posts.deletedAt,
          categoryActive: categories.isActive,
        })
        .from(posts)
        .innerJoin(categories, eq(categories.id, posts.categoryId))
        .where(inArray(posts.id, postIds))
        .all()
    : [];

  const categoryRows = categoryIds.length
    ? db
        .select({ id: categories.id, slug: categories.slug, isActive: categories.isActive })
        .from(categories)
        .where(inArray(categories.id, categoryIds))
        .all()
    : [];

  const postMap = new Map(postRows.map((row) => [row.id, row]));
  const categoryMap = new Map(categoryRows.map((row) => [row.id, row]));

  const result = new Map<number, Resolution>();

  for (const item of items) {
    if (item.itemType === 'CUSTOM') {
      const url = item.url ?? '';
      result.set(
        item.id,
        isSafeLinkTarget(url)
          ? { url, issue: null }
          : { url: null, issue: 'The link target uses an unsupported URL scheme.' },
      );
      continue;
    }

    if (item.itemType === 'POST') {
      const post = item.postId != null ? postMap.get(item.postId) : undefined;
      if (!post) {
        result.set(item.id, { url: null, issue: 'The linked post no longer exists.' });
      } else if (post.deletedAt) {
        result.set(item.id, { url: null, issue: 'The linked post was deleted.' });
      } else if (post.status !== 'PUBLISHED') {
        result.set(item.id, {
          url: null,
          issue: `The linked post is ${post.status.replace('_', ' ').toLowerCase()}, so it is hidden publicly.`,
        });
      } else if (!post.publishedAt || post.publishedAt > now) {
        result.set(item.id, { url: null, issue: 'The linked post is not published yet.' });
      } else if (post.categoryActive !== 1) {
        result.set(item.id, { url: null, issue: "The linked post's category is inactive." });
      } else {
        result.set(item.id, { url: `/posts/${post.slug}`, issue: null });
      }
      continue;
    }

    const category = item.categoryId != null ? categoryMap.get(item.categoryId) : undefined;
    if (!category) {
      result.set(item.id, { url: null, issue: 'The linked category no longer exists.' });
    } else if (category.isActive !== 1) {
      result.set(item.id, { url: null, issue: 'The linked category is inactive.' });
    } else {
      result.set(item.id, { url: `/categories/${category.slug}`, issue: null });
    }
  }

  return result;
}

function buildTree(items: RawItem[], resolutions: Map<number, Resolution>): MenuItemDto[] {
  const dtoById = new Map<number, MenuItemDto>();

  for (const item of items) {
    const resolution = resolutions.get(item.id) ?? { url: null, issue: null };
    dtoById.set(item.id, {
      id: item.id,
      menuId: item.menuId,
      parentId: item.parentId,
      title: item.title,
      itemType: item.itemType,
      url: item.url,
      postId: item.postId,
      categoryId: item.categoryId,
      position: item.position,
      openInNewTab: item.openInNewTab === 1,
      isVisible: item.isVisible === 1,
      resolvedUrl: resolution.url,
      publicIssue: resolution.issue,
      children: [],
    });
  }

  const roots: MenuItemDto[] = [];
  for (const item of items) {
    const dto = dtoById.get(item.id);
    if (!dto) continue;
    if (item.parentId != null && dtoById.has(item.parentId)) {
      dtoById.get(item.parentId)?.children.push(dto);
    } else {
      roots.push(dto);
    }
  }

  const sortTree = (nodes: MenuItemDto[]): MenuItemDto[] => {
    nodes.sort((a, b) => a.position - b.position || a.id - b.id);
    for (const node of nodes) sortTree(node.children);
    return nodes;
  };

  return sortTree(roots);
}

export function listMenus(actor: Principal): MenuDto[] {
  requireMenuManager(actor);
  const db = getDb();
  const now = nowIso();

  return db
    .select()
    .from(menus)
    .orderBy(asc(menus.id))
    .all()
    .map((menu) => {
      const items = loadItems(db, menu.id);
      return {
        id: menu.id,
        name: menu.name,
        location: menu.location,
        isActive: menu.isActive === 1,
        items: buildTree(items, resolveTargets(db, items, now)),
      };
    });
}

export function getMenu(actor: Principal, menuId: number): MenuDto {
  requireMenuManager(actor);
  const db = getDb();
  const menu = db.select().from(menus).where(eq(menus.id, menuId)).get();
  if (!menu) throw AppError.notFound('Menu');

  const items = loadItems(db, menu.id);
  return {
    id: menu.id,
    name: menu.name,
    location: menu.location,
    isActive: menu.isActive === 1,
    items: buildTree(items, resolveTargets(db, items, nowIso())),
  };
}

/**
 * Public menu tree for a location.
 *
 * Items whose target is unpublished, archived, deleted or inactive are dropped
 * entirely (along with their subtree) so the public site never shows a dead link.
 */
export function getPublicMenu(location: MenuLocation): MenuItemDto[] {
  const db = getDb();
  const menu = db
    .select()
    .from(menus)
    .where(and(eq(menus.location, location), eq(menus.isActive, 1)))
    .get();
  if (!menu) return [];

  const items = loadItems(db, menu.id).filter((item) => item.isVisible === 1);
  const resolutions = resolveTargets(db, items, nowIso());
  const usable = items.filter((item) => resolutions.get(item.id)?.url != null);

  return buildTree(usable, resolutions);
}

export interface MenuItemInput {
  title: string;
  itemType: MenuItemType;
  url?: string | null;
  postId?: number | null;
  categoryId?: number | null;
  parentId?: number | null;
  position?: number;
  openInNewTab?: boolean;
  isVisible?: boolean;
}

function validateTarget(
  db: Db,
  input: MenuItemInput,
): {
  url: string | null;
  postId: number | null;
  categoryId: number | null;
} {
  if (input.itemType === 'CUSTOM') {
    const url = (input.url ?? '').trim();
    if (!url) {
      throw AppError.validation('A custom link requires a URL.', { url: ['Enter a URL.'] });
    }
    if (!isSafeLinkTarget(url)) {
      throw AppError.validation(
        'Only http(s) URLs or internal paths starting with "/" are allowed.',
        {
          url: ['Use an http(s) address or an internal path such as /about.'],
        },
      );
    }
    return { url, postId: null, categoryId: null };
  }

  if (input.itemType === 'POST') {
    if (input.postId == null) {
      throw AppError.validation('A post link requires a post.', { postId: ['Select a post.'] });
    }
    const exists = db.select({ id: posts.id }).from(posts).where(eq(posts.id, input.postId)).get();
    if (!exists) {
      throw AppError.validation('The selected post does not exist.', { postId: ['Unknown post.'] });
    }
    return { url: null, postId: input.postId, categoryId: null };
  }

  if (input.categoryId == null) {
    throw AppError.validation('A category link requires a category.', {
      categoryId: ['Select a category.'],
    });
  }
  const exists = db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.id, input.categoryId))
    .get();
  if (!exists) {
    throw AppError.validation('The selected category does not exist.', {
      categoryId: ['Unknown category.'],
    });
  }
  return { url: null, postId: null, categoryId: input.categoryId };
}

function assertParentInMenu(db: Db, menuId: number, parentId: number | null): void {
  if (parentId == null) return;
  const parent = db
    .select({ id: menuItems.id, menuId: menuItems.menuId, parentId: menuItems.parentId })
    .from(menuItems)
    .where(eq(menuItems.id, parentId))
    .get();
  if (!parent || parent.menuId !== menuId) {
    throw new AppError('INVALID_MENU_TREE', 'The parent item belongs to a different menu.');
  }
  if (parent.parentId != null) {
    throw new AppError('INVALID_MENU_TREE', 'Menu nesting is limited to two levels.');
  }
}

export function createMenuItem(ctx: ActorContext, menuId: number, input: MenuItemInput): MenuDto {
  requireMenuManager(ctx.actor);
  const db = getDb();

  db.transaction((tx) => {
    const menu = tx.select().from(menus).where(eq(menus.id, menuId)).get();
    if (!menu) throw AppError.notFound('Menu');

    const target = validateTarget(tx, input);
    assertParentInMenu(tx, menuId, input.parentId ?? null);

    // Append to the end of the sibling list when no explicit position is given.
    const siblingCount =
      tx
        .select({ count: sql<number>`count(*)` })
        .from(menuItems)
        .where(
          and(
            eq(menuItems.menuId, menuId),
            input.parentId == null
              ? sql`${menuItems.parentId} IS NULL`
              : eq(menuItems.parentId, input.parentId),
          ),
        )
        .get()?.count ?? 0;

    const now = nowIso();
    const inserted = tx
      .insert(menuItems)
      .values({
        menuId,
        parentId: input.parentId ?? null,
        title: input.title.trim(),
        itemType: input.itemType,
        url: target.url,
        postId: target.postId,
        categoryId: target.categoryId,
        position: input.position ?? siblingCount,
        openInNewTab: input.openInNewTab ? 1 : 0,
        isVisible: input.isVisible === false ? 0 : 1,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: menuItems.id })
      .get();

    writeAudit(tx, {
      actorId: ctx.actor.id,
      action: 'menu.item_created',
      entityType: 'menu_item',
      entityId: inserted.id,
      metadata: { menuId, title: input.title.trim(), itemType: input.itemType },
      requestId: ctx.requestId,
    });
  });

  return getMenu(ctx.actor, menuId);
}

export interface UpdateMenuItemInput {
  title?: string;
  itemType?: MenuItemType;
  url?: string | null;
  postId?: number | null;
  categoryId?: number | null;
  parentId?: number | null;
  position?: number;
  openInNewTab?: boolean;
  isVisible?: boolean;
}

export function updateMenuItem(
  ctx: ActorContext,
  menuId: number,
  itemId: number,
  input: UpdateMenuItemInput,
): MenuDto {
  requireMenuManager(ctx.actor);
  const db = getDb();

  db.transaction((tx) => {
    const current = tx
      .select()
      .from(menuItems)
      .where(and(eq(menuItems.id, itemId), eq(menuItems.menuId, menuId)))
      .get();
    if (!current) throw AppError.notFound('Menu item');

    const nextType = input.itemType ?? current.itemType;
    const target =
      input.itemType !== undefined ||
      input.url !== undefined ||
      input.postId !== undefined ||
      input.categoryId !== undefined
        ? validateTarget(tx, {
            title: input.title ?? current.title,
            itemType: nextType,
            url: input.url !== undefined ? input.url : current.url,
            postId: input.postId !== undefined ? input.postId : current.postId,
            categoryId: input.categoryId !== undefined ? input.categoryId : current.categoryId,
          })
        : { url: current.url, postId: current.postId, categoryId: current.categoryId };

    if (input.parentId !== undefined && input.parentId !== current.parentId) {
      assertParentInMenu(tx, menuId, input.parentId);
      const nodes: TreeNode[] = tx
        .select({ id: menuItems.id, parentId: menuItems.parentId })
        .from(menuItems)
        .where(eq(menuItems.menuId, menuId))
        .all();
      const error = validateReparent(nodes, itemId, input.parentId);
      if (error) {
        throw new AppError('INVALID_MENU_TREE', describeTreeError(error));
      }
    }

    tx.update(menuItems)
      .set({
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        ...(input.itemType !== undefined ? { itemType: nextType } : {}),
        url: target.url,
        postId: target.postId,
        categoryId: target.categoryId,
        ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
        ...(input.position !== undefined ? { position: input.position } : {}),
        ...(input.openInNewTab !== undefined ? { openInNewTab: input.openInNewTab ? 1 : 0 } : {}),
        ...(input.isVisible !== undefined ? { isVisible: input.isVisible ? 1 : 0 } : {}),
        updatedAt: nowIso(),
      })
      .where(eq(menuItems.id, itemId))
      .run();

    writeAudit(tx, {
      actorId: ctx.actor.id,
      action: 'menu.item_updated',
      entityType: 'menu_item',
      entityId: itemId,
      metadata: { menuId },
      requestId: ctx.requestId,
    });
  });

  return getMenu(ctx.actor, menuId);
}

export function deleteMenuItem(ctx: ActorContext, menuId: number, itemId: number): MenuDto {
  requireMenuManager(ctx.actor);
  const db = getDb();

  db.transaction((tx) => {
    const current = tx
      .select()
      .from(menuItems)
      .where(and(eq(menuItems.id, itemId), eq(menuItems.menuId, menuId)))
      .get();
    if (!current) throw AppError.notFound('Menu item');

    // ON DELETE CASCADE on menu_items.parent_id removes the subtree with it.
    tx.delete(menuItems).where(eq(menuItems.id, itemId)).run();

    writeAudit(tx, {
      actorId: ctx.actor.id,
      action: 'menu.item_deleted',
      entityType: 'menu_item',
      entityId: itemId,
      metadata: { menuId, title: current.title },
      requestId: ctx.requestId,
    });
  });

  return getMenu(ctx.actor, menuId);
}

export interface ReorderEntry {
  id: number;
  parentId: number | null;
  position: number;
}

/**
 * Atomically replace the whole ordering of one menu.
 *
 * The payload must list every current item exactly once. Anything else — a
 * missing item, a duplicate, a foreign id, a cycle, a duplicate sibling
 * position — rejects the entire request, so a half-applied order is impossible.
 */
export function reorderMenu(ctx: ActorContext, menuId: number, entries: ReorderEntry[]): MenuDto {
  requireMenuManager(ctx.actor);
  const db = getDb();

  db.transaction((tx) => {
    const menu = tx.select().from(menus).where(eq(menus.id, menuId)).get();
    if (!menu) throw AppError.notFound('Menu');

    const existing = tx
      .select({ id: menuItems.id })
      .from(menuItems)
      .where(eq(menuItems.menuId, menuId))
      .all();
    const existingIds = new Set(existing.map((row) => row.id));

    const seen = new Set<number>();
    for (const entry of entries) {
      if (seen.has(entry.id)) {
        throw new AppError('INVALID_MENU_TREE', `Item ${entry.id} appears more than once.`);
      }
      seen.add(entry.id);
      if (!existingIds.has(entry.id)) {
        throw new AppError('INVALID_MENU_TREE', `Item ${entry.id} does not belong to this menu.`);
      }
      if (entry.position < 0 || !Number.isInteger(entry.position)) {
        throw new AppError('INVALID_MENU_TREE', 'Positions must be non-negative integers.');
      }
    }

    for (const id of existingIds) {
      if (!seen.has(id)) {
        throw new AppError(
          'INVALID_MENU_TREE',
          `The payload must contain every item in the menu; item ${id} is missing.`,
        );
      }
    }

    const treeErrors = validateTree(entries.map(({ id, parentId }) => ({ id, parentId })));
    if (treeErrors.length > 0) {
      const first = treeErrors[0];
      throw new AppError(
        'INVALID_MENU_TREE',
        first ? describeTreeError(first) : 'The requested menu tree is invalid.',
      );
    }

    // Duplicate positions among siblings would make the public order arbitrary.
    const bySibling = new Map<string, Set<number>>();
    for (const entry of entries) {
      const key = String(entry.parentId ?? 'root');
      const bucket = bySibling.get(key) ?? new Set<number>();
      if (bucket.has(entry.position)) {
        throw new AppError(
          'INVALID_MENU_TREE',
          'Two sibling items cannot share the same position.',
        );
      }
      bucket.add(entry.position);
      bySibling.set(key, bucket);
    }

    const now = nowIso();
    for (const entry of entries) {
      tx.update(menuItems)
        .set({ parentId: entry.parentId, position: entry.position, updatedAt: now })
        .where(and(eq(menuItems.id, entry.id), eq(menuItems.menuId, menuId)))
        .run();
    }

    writeAudit(tx, {
      actorId: ctx.actor.id,
      action: 'menu.reordered',
      entityType: 'menu',
      entityId: menuId,
      metadata: { itemCount: entries.length },
      requestId: ctx.requestId,
    });
  });

  return getMenu(ctx.actor, menuId);
}
