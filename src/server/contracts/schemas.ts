import { z } from 'zod';
import { MIN_PASSWORD_LENGTH } from '@/lib/domain';
import {
  menuItemTypeSchema,
  postStatusSchema,
  postSortSchema,
  roleSchema,
  sortOrderSchema,
  userStatusSchema,
} from './common';

/** Request/response schemas per resource. */

/* ---------------------------------- auth --------------------------------- */

export const loginBody = z.object({
  email: z.string().trim().min(1).max(320),
  password: z.string().min(1).max(200),
});

export const changePasswordBody = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(MIN_PASSWORD_LENGTH).max(200),
});

/* ---------------------------------- users -------------------------------- */

export const createUserBody = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(320),
  password: z.string().min(MIN_PASSWORD_LENGTH).max(200),
  role: roleSchema,
});

export const updateUserBody = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    role: roleSchema.optional(),
    status: userStatusSchema.optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Provide at least one field to update.',
  });

export const resetPasswordBody = z.object({
  newPassword: z.string().min(MIN_PASSWORD_LENGTH).max(200),
});

export const listUsersQuery = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  q: z.string().trim().max(200).optional(),
  role: roleSchema.optional(),
  status: userStatusSchema.optional(),
  sort: z.string().optional(),
  order: sortOrderSchema.optional(),
});

/* -------------------------------- categories ------------------------------ */

const slugField = z
  .string()
  .trim()
  .min(2)
  .max(220)
  .regex(/^[A-Za-z0-9\s\-_]+$/, 'Use letters, numbers, spaces, hyphens or underscores.');

export const categorySchema = z.object({
  id: z.number().int(),
  parentId: z.number().int().nullable(),
  title: z.string(),
  slug: z.string(),
  description: z.string(),
  isActive: z.boolean(),
  postCount: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const createCategoryBody = z.object({
  title: z.string().trim().min(2).max(100),
  slug: slugField.optional(),
  description: z.string().trim().max(2000).optional(),
  parentId: z.number().int().positive().nullable().optional(),
  isActive: z.boolean().optional(),
});

export const updateCategoryBody = z
  .object({
    title: z.string().trim().min(2).max(100).optional(),
    slug: slugField.optional(),
    description: z.string().trim().max(2000).optional(),
    parentId: z.number().int().positive().nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update.',
  });

/* ----------------------------------- posts -------------------------------- */

export const postSummarySchema = z.object({
  id: z.number().int(),
  subject: z.string(),
  slug: z.string(),
  excerpt: z.string(),
  status: postStatusSchema,
  categoryId: z.number().int(),
  categoryTitle: z.string(),
  categorySlug: z.string(),
  authorId: z.number().int(),
  authorName: z.string(),
  readsCount: z.number().int(),
  version: z.number().int(),
  featuredImageId: z.number().int().nullable(),
  featuredImageAlt: z.string().nullable(),
  scheduledAt: z.string().nullable(),
  publishedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const postDetailSchema = postSummarySchema.extend({
  content: z.string(),
  sourceUrl: z.string().nullable(),
  seoTitle: z.string().nullable(),
  seoDescription: z.string().nullable(),
  deletedAt: z.string().nullable(),
});

const sourceUrlField = z.string().trim().max(2048).nullable().optional();

export const createPostBody = z.object({
  categoryId: z.number().int().positive(),
  subject: z.string().trim().min(3).max(200),
  slug: slugField.optional(),
  excerpt: z.string().trim().max(500).optional(),
  content: z.string().min(1).max(500_000),
  sourceUrl: sourceUrlField,
  featuredImageId: z.number().int().positive().nullable().optional(),
  seoTitle: z.string().trim().max(120).nullable().optional(),
  seoDescription: z.string().trim().max(300).nullable().optional(),
});

export const updatePostBody = z.object({
  expectedVersion: z.number().int().positive(),
  categoryId: z.number().int().positive().optional(),
  subject: z.string().trim().min(3).max(200).optional(),
  slug: slugField.optional(),
  excerpt: z.string().trim().max(500).optional(),
  content: z.string().min(1).max(500_000).optional(),
  sourceUrl: sourceUrlField,
  featuredImageId: z.number().int().positive().nullable().optional(),
  seoTitle: z.string().trim().max(120).nullable().optional(),
  seoDescription: z.string().trim().max(300).nullable().optional(),
  changeSummary: z.string().trim().max(300).nullable().optional(),
});

export const listPostsQuery = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  status: postStatusSchema.optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  authorId: z.coerce.number().int().positive().optional(),
  q: z.string().trim().max(200).optional(),
  sort: postSortSchema.optional(),
  order: sortOrderSchema.optional(),
});

export const workflowBody = z.object({
  expectedVersion: z.number().int().positive(),
  comment: z.string().trim().max(2000).nullable().optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
});

export const deletePostBody = z.object({ expectedVersion: z.number().int().positive() });

/* --------------------------------- revisions ------------------------------ */

export const revisionSummarySchema = z.object({
  id: z.number().int(),
  postId: z.number().int(),
  version: z.number().int(),
  subject: z.string(),
  slug: z.string(),
  status: z.string(),
  changeSummary: z.string().nullable(),
  savedBy: z.number().int(),
  savedByName: z.string(),
  createdAt: z.string(),
  isCurrent: z.boolean(),
});

export const revisionDetailSchema = revisionSummarySchema.extend({
  categoryId: z.number().int(),
  featuredImageId: z.number().int().nullable(),
  excerpt: z.string(),
  content: z.string(),
  sourceUrl: z.string().nullable(),
  seoTitle: z.string().nullable(),
  seoDescription: z.string().nullable(),
  scheduledAt: z.string().nullable(),
  publishedAt: z.string().nullable(),
});

export const restoreRevisionBody = z.object({
  expectedVersion: z.number().int().positive(),
  changeSummary: z.string().trim().max(300).nullable().optional(),
});

/* ----------------------------------- menus -------------------------------- */

export interface MenuItemShape {
  id: number;
  menuId: number;
  parentId: number | null;
  title: string;
  itemType: 'CUSTOM' | 'POST' | 'CATEGORY';
  url: string | null;
  postId: number | null;
  categoryId: number | null;
  position: number;
  openInNewTab: boolean;
  isVisible: boolean;
  resolvedUrl: string | null;
  publicIssue: string | null;
  children: MenuItemShape[];
}

export const menuItemSchema: z.ZodType<MenuItemShape> = z.lazy(() =>
  z.object({
    id: z.number().int(),
    menuId: z.number().int(),
    parentId: z.number().int().nullable(),
    title: z.string(),
    itemType: menuItemTypeSchema,
    url: z.string().nullable(),
    postId: z.number().int().nullable(),
    categoryId: z.number().int().nullable(),
    position: z.number().int(),
    openInNewTab: z.boolean(),
    isVisible: z.boolean(),
    resolvedUrl: z.string().nullable(),
    publicIssue: z.string().nullable(),
    children: z.array(menuItemSchema),
  }),
);

export const menuSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  location: z.enum(['HEADER', 'FOOTER']),
  isActive: z.boolean(),
  items: z.array(menuItemSchema),
});

export const createMenuItemBody = z.object({
  title: z.string().trim().min(1).max(100),
  itemType: menuItemTypeSchema,
  url: z.string().trim().max(2048).nullable().optional(),
  postId: z.number().int().positive().nullable().optional(),
  categoryId: z.number().int().positive().nullable().optional(),
  parentId: z.number().int().positive().nullable().optional(),
  position: z.number().int().min(0).optional(),
  openInNewTab: z.boolean().optional(),
  isVisible: z.boolean().optional(),
});

export const updateMenuItemBody = z
  .object({
    title: z.string().trim().min(1).max(100).optional(),
    itemType: menuItemTypeSchema.optional(),
    url: z.string().trim().max(2048).nullable().optional(),
    postId: z.number().int().positive().nullable().optional(),
    categoryId: z.number().int().positive().nullable().optional(),
    parentId: z.number().int().positive().nullable().optional(),
    position: z.number().int().min(0).optional(),
    openInNewTab: z.boolean().optional(),
    isVisible: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update.',
  });

export const reorderMenuBody = z.object({
  items: z
    .array(
      z.object({
        id: z.number().int().positive(),
        parentId: z.number().int().positive().nullable(),
        position: z.number().int().min(0),
      }),
    )
    .max(500),
});

/* ----------------------------------- media -------------------------------- */

export const mediaSchema = z.object({
  id: z.number().int(),
  originalName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  altText: z.string().nullable(),
  uploadedBy: z.number().int(),
  uploadedByName: z.string(),
  createdAt: z.string(),
  url: z.string(),
});

export const updateMediaBody = z.object({ altText: z.string().trim().max(300).nullable() });

/* ---------------------------------- settings ------------------------------ */

export const settingsSchema = z.object({
  siteName: z.string(),
  siteDescription: z.string(),
  logoMediaId: z.number().int().nullable(),
  logoUrl: z.string().nullable(),
  defaultSeoTitle: z.string().nullable(),
  defaultSeoDescription: z.string().nullable(),
  postsPerPage: z.number().int(),
  timezone: z.string(),
  updatedBy: z.number().int().nullable(),
  updatedByName: z.string().nullable(),
  updatedAt: z.string(),
});

export const publicSettingsSchema = z.object({
  siteName: z.string(),
  siteDescription: z.string(),
  logoUrl: z.string().nullable(),
  defaultSeoTitle: z.string().nullable(),
  defaultSeoDescription: z.string().nullable(),
  postsPerPage: z.number().int(),
  timezone: z.string(),
});

export const updateSettingsBody = z
  .object({
    siteName: z.string().trim().min(1).max(120).optional(),
    siteDescription: z.string().trim().max(300).optional(),
    logoMediaId: z.number().int().positive().nullable().optional(),
    defaultSeoTitle: z.string().trim().max(120).nullable().optional(),
    defaultSeoDescription: z.string().trim().max(300).nullable().optional(),
    postsPerPage: z.number().int().min(1).max(100).optional(),
    timezone: z.string().trim().min(1).max(64).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one setting to update.',
  });

/* ----------------------------------- audit -------------------------------- */

export const auditLogSchema = z.object({
  id: z.number().int(),
  actorId: z.number().int().nullable(),
  actorName: z.string().nullable(),
  actorEmail: z.string().nullable(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  requestId: z.string().nullable(),
  createdAt: z.string(),
});

export const listAuditQuery = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  actorId: z.coerce.number().int().positive().optional(),
  action: z.string().max(100).optional(),
  entityType: z.string().max(50).optional(),
  entityId: z.string().max(50).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

/* ----------------------------------- public ------------------------------- */

export const publicPostSummarySchema = z.object({
  id: z.number().int(),
  subject: z.string(),
  slug: z.string(),
  excerpt: z.string(),
  categoryTitle: z.string(),
  categorySlug: z.string(),
  authorName: z.string(),
  readsCount: z.number().int(),
  publishedAt: z.string().nullable(),
  featuredImageId: z.number().int().nullable(),
  featuredImageAlt: z.string().nullable(),
});

export const publicPostDetailSchema = publicPostSummarySchema.extend({
  content: z.string(),
  sourceUrl: z.string().nullable(),
  seoTitle: z.string().nullable(),
  seoDescription: z.string().nullable(),
  updatedAt: z.string(),
});

export const publicCategorySchema = z.object({
  id: z.number().int(),
  title: z.string(),
  slug: z.string(),
  description: z.string(),
  postCount: z.number().int(),
});

export const publicListQuery = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  q: z.string().trim().max(120).optional(),
  category: z.string().trim().max(220).optional(),
});

export const viewResultSchema = z.object({ counted: z.boolean(), readsCount: z.number().int() });
