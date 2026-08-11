import 'server-only';
import { and, asc, eq, isNull, ne, sql } from 'drizzle-orm';
import { getDb, type Db } from '@/server/db';
import { categories, menuItems, posts } from '@/server/db/schema';
import { nowIso } from '@/lib/datetime';
import { can } from '@/lib/permissions';
import { isValidSlug, normalizeSlug, uniqueSlug } from '@/lib/slug';
import { describeTreeError, validateReparent, type TreeNode } from '@/lib/tree';
import type { Principal } from '@/lib/domain';
import { AppError } from '@/server/errors/app-error';
import { writeAudit } from './audit-service';
import type { ActorContext } from './context';

/**
 * Category administration.
 *
 * Deletion is hard, not soft — but only when nothing references the row. A
 * category still used by posts or child categories returns RESOURCE_IN_USE with
 * enough detail for the UI to say *why*, which is more useful than a bare 409.
 */

export interface CategoryDto {
  id: number;
  parentId: number | null;
  title: string;
  slug: string;
  description: string;
  isActive: boolean;
  postCount: number;
  createdAt: string;
  updatedAt: string;
}

const COLUMNS = {
  id: categories.id,
  parentId: categories.parentId,
  title: categories.title,
  slug: categories.slug,
  description: categories.description,
  isActive: categories.isActive,
  createdAt: categories.createdAt,
  updatedAt: categories.updatedAt,
} as const;

function requireCategoryManager(actor: Principal): void {
  if (!can(actor.role, 'category.manage')) {
    throw AppError.forbidden('Only administrators and editors can manage categories.');
  }
}

function toDto(
  row: {
    id: number;
    parentId: number | null;
    title: string;
    slug: string;
    description: string;
    isActive: number;
    createdAt: string;
    updatedAt: string;
  },
  postCount = 0,
): CategoryDto {
  return {
    id: row.id,
    parentId: row.parentId,
    title: row.title,
    slug: row.slug,
    description: row.description,
    isActive: row.isActive === 1,
    postCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * All categories with a post count, in one query per table rather than one query
 * per category (the N+1 the specification calls out).
 */
export function listCategories(options: { activeOnly?: boolean } = {}): CategoryDto[] {
  const db = getDb();
  const rows = db
    .select(COLUMNS)
    .from(categories)
    .where(options.activeOnly ? eq(categories.isActive, 1) : undefined)
    .orderBy(asc(categories.title))
    .all();

  const counts = new Map<number, number>();
  for (const row of db
    .select({ categoryId: posts.categoryId, count: sql<number>`count(*)` })
    .from(posts)
    .where(isNull(posts.deletedAt))
    .groupBy(posts.categoryId)
    .all()) {
    counts.set(row.categoryId, row.count);
  }

  return rows.map((row) => toDto(row, counts.get(row.id) ?? 0));
}

export function getCategoryById(id: number): CategoryDto {
  const row = getDb().select(COLUMNS).from(categories).where(eq(categories.id, id)).get();
  if (!row) throw AppError.notFound('Category');
  const count =
    getDb()
      .select({ count: sql<number>`count(*)` })
      .from(posts)
      .where(and(eq(posts.categoryId, id), isNull(posts.deletedAt)))
      .get()?.count ?? 0;
  return toDto(row, count);
}

export function getActiveCategoryBySlug(slug: string): CategoryDto | null {
  const row = getDb()
    .select(COLUMNS)
    .from(categories)
    .where(and(eq(categories.slug, slug), eq(categories.isActive, 1)))
    .get();
  return row ? toDto(row) : null;
}

function slugTaken(db: Db, slug: string, exceptId?: number): boolean {
  const conditions = [eq(categories.slug, slug)];
  if (exceptId !== undefined) conditions.push(ne(categories.id, exceptId));
  return (
    db
      .select({ id: categories.id })
      .from(categories)
      .where(and(...conditions))
      .get() !== undefined
  );
}

function loadTreeNodes(db: Db): TreeNode[] {
  return db.select({ id: categories.id, parentId: categories.parentId }).from(categories).all();
}

export interface CreateCategoryInput {
  title: string;
  slug?: string | null;
  description?: string;
  parentId?: number | null;
  isActive?: boolean;
}

export function createCategory(ctx: ActorContext, input: CreateCategoryInput): CategoryDto {
  requireCategoryManager(ctx.actor);
  const db = getDb();

  return db.transaction((tx) => {
    let slug: string;
    if (input.slug) {
      slug = normalizeSlug(input.slug);
      if (!isValidSlug(slug)) {
        throw AppError.validation(
          'The slug must contain only lowercase letters, numbers and hyphens.',
          {
            slug: ['Use lowercase letters, numbers and hyphens only.'],
          },
        );
      }
      if (slugTaken(tx, slug)) {
        throw new AppError('SLUG_EXISTS', 'Another category already uses this slug.');
      }
    } else {
      slug = uniqueSlug(input.title, (candidate) => slugTaken(tx, candidate), 120);
    }

    if (input.parentId != null) {
      const parent = tx
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.id, input.parentId))
        .get();
      if (!parent) {
        throw AppError.validation('The selected parent category does not exist.', {
          parentId: ['Unknown parent category.'],
        });
      }
      const nodes = loadTreeNodes(tx);
      // The new row does not exist yet; probe with a placeholder id.
      const probeId = -1;
      const error = validateReparent(
        [...nodes, { id: probeId, parentId: null }],
        probeId,
        input.parentId,
      );
      if (error) {
        throw AppError.validation(describeTreeError(error), {
          parentId: [describeTreeError(error)],
        });
      }
    }

    const now = nowIso();
    const inserted = tx
      .insert(categories)
      .values({
        title: input.title.trim(),
        slug,
        description: (input.description ?? '').trim(),
        parentId: input.parentId ?? null,
        isActive: input.isActive === false ? 0 : 1,
        createdAt: now,
        updatedAt: now,
      })
      .returning(COLUMNS)
      .get();

    writeAudit(tx, {
      actorId: ctx.actor.id,
      action: 'category.created',
      entityType: 'category',
      entityId: inserted.id,
      metadata: { title: inserted.title, slug: inserted.slug },
      requestId: ctx.requestId,
    });

    return toDto(inserted);
  });
}

export interface UpdateCategoryInput {
  title?: string;
  slug?: string;
  description?: string;
  parentId?: number | null;
  isActive?: boolean;
}

export function updateCategory(
  ctx: ActorContext,
  id: number,
  input: UpdateCategoryInput,
): CategoryDto {
  requireCategoryManager(ctx.actor);
  const db = getDb();

  return db.transaction((tx) => {
    const current = tx.select(COLUMNS).from(categories).where(eq(categories.id, id)).get();
    if (!current) throw AppError.notFound('Category');

    let slug = current.slug;
    if (input.slug !== undefined && input.slug !== current.slug) {
      slug = normalizeSlug(input.slug);
      if (!isValidSlug(slug)) {
        throw AppError.validation(
          'The slug must contain only lowercase letters, numbers and hyphens.',
          {
            slug: ['Use lowercase letters, numbers and hyphens only.'],
          },
        );
      }
      if (slugTaken(tx, slug, id)) {
        throw new AppError('SLUG_EXISTS', 'Another category already uses this slug.');
      }
    }

    if (input.parentId !== undefined && input.parentId !== current.parentId) {
      if (input.parentId != null) {
        const parent = tx
          .select({ id: categories.id })
          .from(categories)
          .where(eq(categories.id, input.parentId))
          .get();
        if (!parent) {
          throw AppError.validation('The selected parent category does not exist.', {
            parentId: ['Unknown parent category.'],
          });
        }
      }
      const error = validateReparent(loadTreeNodes(tx), id, input.parentId ?? null);
      if (error) {
        throw AppError.validation(describeTreeError(error), {
          parentId: [describeTreeError(error)],
        });
      }
    }

    const updated = tx
      .update(categories)
      .set({
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        ...(input.slug !== undefined ? { slug } : {}),
        ...(input.description !== undefined ? { description: input.description.trim() } : {}),
        ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive ? 1 : 0 } : {}),
        updatedAt: nowIso(),
      })
      .where(eq(categories.id, id))
      .returning(COLUMNS)
      .get();

    writeAudit(tx, {
      actorId: ctx.actor.id,
      action: 'category.updated',
      entityType: 'category',
      entityId: id,
      metadata: { title: updated.title, slug: updated.slug, isActive: updated.isActive === 1 },
      requestId: ctx.requestId,
    });

    return toDto(updated);
  });
}

export function deleteCategory(ctx: ActorContext, id: number): void {
  requireCategoryManager(ctx.actor);
  const db = getDb();

  db.transaction((tx) => {
    const current = tx.select(COLUMNS).from(categories).where(eq(categories.id, id)).get();
    if (!current) throw AppError.notFound('Category');

    // Soft-deleted posts still count: their slug stays reserved and restoring
    // them must not resurrect a dangling category reference.
    const postCount =
      tx
        .select({ count: sql<number>`count(*)` })
        .from(posts)
        .where(eq(posts.categoryId, id))
        .get()?.count ?? 0;

    const childCount =
      tx
        .select({ count: sql<number>`count(*)` })
        .from(categories)
        .where(eq(categories.parentId, id))
        .get()?.count ?? 0;

    const menuCount =
      tx
        .select({ count: sql<number>`count(*)` })
        .from(menuItems)
        .where(eq(menuItems.categoryId, id))
        .get()?.count ?? 0;

    if (postCount > 0 || childCount > 0) {
      throw new AppError(
        'RESOURCE_IN_USE',
        'This category is still in use and cannot be deleted. Deactivate it instead.',
        { posts: postCount, childCategories: childCount, menuItems: menuCount },
      );
    }

    tx.delete(categories).where(eq(categories.id, id)).run();

    writeAudit(tx, {
      actorId: ctx.actor.id,
      action: 'category.deleted',
      entityType: 'category',
      entityId: id,
      metadata: { title: current.title, slug: current.slug },
      requestId: ctx.requestId,
    });
  });
}
