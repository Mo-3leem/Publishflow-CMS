/**
 * Domain vocabulary shared by server services, API contracts and UI.
 * Pure types + constants only — safe to import from client components.
 */

export const USER_ROLES = ['ADMIN', 'EDITOR', 'AUTHOR'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_STATUSES = ['ACTIVE', 'DISABLED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const POST_STATUSES = ['DRAFT', 'IN_REVIEW', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED'] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

export const MENU_LOCATIONS = ['HEADER', 'FOOTER'] as const;
export type MenuLocation = (typeof MENU_LOCATIONS)[number];

export const MENU_ITEM_TYPES = ['CUSTOM', 'POST', 'CATEGORY'] as const;
export type MenuItemType = (typeof MENU_ITEM_TYPES)[number];

export const POST_SORT_FIELDS = [
  'updatedAt',
  'createdAt',
  'publishedAt',
  'subject',
  'readsCount',
  'status',
] as const;
export type PostSortField = (typeof POST_SORT_FIELDS)[number];

export const SORT_ORDERS = ['asc', 'desc'] as const;
export type SortOrder = (typeof SORT_ORDERS)[number];

/** Maximum nesting depth for categories and menus (two levels: root + child). */
export const MAX_TREE_DEPTH = 2;

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 20;

export const ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type AllowedImageMimeType = (typeof ALLOWED_IMAGE_MIME_TYPES)[number];

export const MIN_PASSWORD_LENGTH = 12;

export const POST_STATUS_LABELS: Record<PostStatus, string> = {
  DRAFT: 'Draft',
  IN_REVIEW: 'In review',
  SCHEDULED: 'Scheduled',
  PUBLISHED: 'Published',
  ARCHIVED: 'Archived',
};

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: 'Admin',
  EDITOR: 'Editor',
  AUTHOR: 'Author',
};

export interface SafeUser {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
}

export interface Principal {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
