import type { PostStatus, UserRole } from './domain';

/**
 * The permission matrix from the specification, expressed as pure predicates.
 *
 * Services call these before every protected operation; the UI calls the same
 * functions only to decide what to render. Hiding a button is never the control.
 */

export type Capability =
  | 'dashboard.view'
  | 'post.create'
  | 'post.readAll'
  | 'post.editAny'
  | 'post.delete'
  | 'post.publish'
  | 'post.archive'
  | 'revision.restore'
  | 'category.manage'
  | 'menu.manage'
  | 'media.manageAll'
  | 'media.upload'
  | 'settings.manage'
  | 'user.manage'
  | 'audit.view';

const MATRIX: Record<Capability, readonly UserRole[]> = {
  'dashboard.view': ['ADMIN', 'EDITOR', 'AUTHOR'],
  'post.create': ['ADMIN', 'EDITOR', 'AUTHOR'],
  'post.readAll': ['ADMIN', 'EDITOR'],
  'post.editAny': ['ADMIN', 'EDITOR'],
  'post.delete': ['ADMIN', 'EDITOR'],
  'post.publish': ['ADMIN', 'EDITOR'],
  'post.archive': ['ADMIN', 'EDITOR'],
  'revision.restore': ['ADMIN', 'EDITOR'],
  'category.manage': ['ADMIN', 'EDITOR'],
  'menu.manage': ['ADMIN', 'EDITOR'],
  'media.manageAll': ['ADMIN', 'EDITOR'],
  'media.upload': ['ADMIN', 'EDITOR', 'AUTHOR'],
  'settings.manage': ['ADMIN'],
  'user.manage': ['ADMIN'],
  'audit.view': ['ADMIN'],
};

export function can(role: UserRole, capability: Capability): boolean {
  return MATRIX[capability].includes(role);
}

/** May the actor open this post in the admin editor / read it through the staff API? */
export function canReadPost(role: UserRole, actorId: number, authorId: number): boolean {
  return can(role, 'post.readAll') || actorId === authorId;
}

/**
 * May the actor change post content?
 *
 * Authors own only their own drafts: once a post is submitted it becomes
 * read-only for them, which is the whole point of the review queue.
 */
export function canEditPost(
  role: UserRole,
  actorId: number,
  authorId: number,
  status: PostStatus,
): boolean {
  if (can(role, 'post.editAny')) return true;
  return actorId === authorId && status === 'DRAFT';
}

/** May the actor list/see revision history for this post? */
export function canViewRevisions(role: UserRole, actorId: number, authorId: number): boolean {
  return canReadPost(role, actorId, authorId);
}

/** Editing another user's media metadata is Admin/Editor only; owners may edit their own. */
export function canEditMedia(role: UserRole, actorId: number, uploaderId: number): boolean {
  return can(role, 'media.manageAll') || actorId === uploaderId;
}
