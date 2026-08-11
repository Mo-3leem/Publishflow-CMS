import { z } from 'zod';
import {
  MAX_PAGE_SIZE,
  POST_SORT_FIELDS,
  POST_STATUSES,
  SORT_ORDERS,
  USER_ROLES,
  USER_STATUSES,
  MENU_ITEM_TYPES,
  MENU_LOCATIONS,
} from '@/lib/domain';
import { ERROR_CODES } from '@/server/errors/app-error';

/**
 * Shared Zod schemas.
 *
 * These objects drive both request validation and the generated OpenAPI
 * document, so the published contract cannot drift from what the server accepts.
 * Schema *names* live in the OpenAPI registry rather than in `.meta({ id })`
 * here, because per-schema `id` metadata makes `z.toJSONSchema` return a `$ref`
 * instead of the inline object the components map needs.
 */

export const idParam = z.coerce.number().int().positive();

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
});

export const paginationMetaSchema = z.object({
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
  totalPages: z.number().int(),
});

export const errorSchema = z.object({
  error: z.object({
    code: z.enum(Object.keys(ERROR_CODES) as [string, ...string[]]),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
    requestId: z.string(),
  }),
});

export const roleSchema = z.enum(USER_ROLES);
export const userStatusSchema = z.enum(USER_STATUSES);
export const postStatusSchema = z.enum(POST_STATUSES);
export const postSortSchema = z.enum(POST_SORT_FIELDS);
export const sortOrderSchema = z.enum(SORT_ORDERS);
export const menuLocationSchema = z.enum(MENU_LOCATIONS);
export const menuItemTypeSchema = z.enum(MENU_ITEM_TYPES);

export const safeUserSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  email: z.string(),
  role: roleSchema,
  status: userStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  lastLoginAt: z.string().nullable(),
});

/** `{ "data": T }` envelope used by every single-resource response. */
export function dataObject<T extends z.ZodTypeAny>(schema: T) {
  return z.object({ data: schema });
}

/** `{ "data": T[], "meta": {...} }` envelope used by every list response. */
export function dataList<T extends z.ZodTypeAny>(schema: T) {
  return z.object({ data: z.array(schema), meta: paginationMetaSchema });
}

export const messageSchema = z.object({ data: z.object({ message: z.string() }) });
