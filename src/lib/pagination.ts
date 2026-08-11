import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, type PaginationMeta } from './domain';

/**
 * Pagination + sort parsing.
 *
 * Sort fields are resolved against an explicit allow-list; user input never
 * reaches SQL as a column name.
 */

export interface PageRequest {
  page: number;
  pageSize: number;
  offset: number;
}

export function parsePagination(
  rawPage: unknown,
  rawPageSize: unknown,
  defaultPageSize = DEFAULT_PAGE_SIZE,
): PageRequest {
  const page = clampInt(rawPage, 1, Number.MAX_SAFE_INTEGER, 1);
  const pageSize = clampInt(rawPageSize, 1, MAX_PAGE_SIZE, defaultPageSize);
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value, 10)
        : NaN;
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

export function buildMeta(page: number, pageSize: number, total: number): PaginationMeta {
  return {
    page,
    pageSize,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
  };
}

/** Resolve a user-supplied sort field against an allow-list. */
export function resolveSort<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

export function resolveOrder(value: unknown, fallback: 'asc' | 'desc' = 'desc'): 'asc' | 'desc' {
  return value === 'asc' || value === 'desc' ? value : fallback;
}
