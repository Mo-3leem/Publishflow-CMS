import { describe, expect, it } from 'vitest';
import { can, canEditPost, canEditMedia, canReadPost, canViewRevisions } from '@/lib/permissions';
import { POST_STATUSES, USER_ROLES, type PostStatus } from '@/lib/domain';

describe('role capability matrix', () => {
  it('matches the specification table exactly', () => {
    const expected: Record<string, Record<string, boolean>> = {
      'dashboard.view': { ADMIN: true, EDITOR: true, AUTHOR: true },
      'post.create': { ADMIN: true, EDITOR: true, AUTHOR: true },
      'post.editAny': { ADMIN: true, EDITOR: true, AUTHOR: false },
      'post.publish': { ADMIN: true, EDITOR: true, AUTHOR: false },
      'post.archive': { ADMIN: true, EDITOR: true, AUTHOR: false },
      'revision.restore': { ADMIN: true, EDITOR: true, AUTHOR: false },
      'category.manage': { ADMIN: true, EDITOR: true, AUTHOR: false },
      'menu.manage': { ADMIN: true, EDITOR: true, AUTHOR: false },
      'media.manageAll': { ADMIN: true, EDITOR: true, AUTHOR: false },
      'media.upload': { ADMIN: true, EDITOR: true, AUTHOR: true },
      'settings.manage': { ADMIN: true, EDITOR: false, AUTHOR: false },
      'user.manage': { ADMIN: true, EDITOR: false, AUTHOR: false },
      'audit.view': { ADMIN: true, EDITOR: false, AUTHOR: false },
    };

    for (const [capability, roles] of Object.entries(expected)) {
      for (const role of USER_ROLES) {
        expect(can(role, capability as Parameters<typeof can>[1]), `${role} → ${capability}`).toBe(
          roles[role],
        );
      }
    }
  });
});

describe('canReadPost', () => {
  it('lets editors and admins read anyone’s post', () => {
    expect(canReadPost('ADMIN', 1, 99)).toBe(true);
    expect(canReadPost('EDITOR', 1, 99)).toBe(true);
  });

  it('lets an author read only their own posts', () => {
    expect(canReadPost('AUTHOR', 7, 7)).toBe(true);
    expect(canReadPost('AUTHOR', 7, 8)).toBe(false);
  });
});

describe('canEditPost', () => {
  it('lets editors and admins edit a post in any status', () => {
    for (const status of POST_STATUSES) {
      expect(canEditPost('ADMIN', 1, 99, status)).toBe(true);
      expect(canEditPost('EDITOR', 1, 99, status)).toBe(true);
    }
  });

  it('lets an author edit only their own DRAFT', () => {
    expect(canEditPost('AUTHOR', 7, 7, 'DRAFT')).toBe(true);
  });

  it('locks a post for its author once it leaves DRAFT', () => {
    const locked: PostStatus[] = ['IN_REVIEW', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED'];
    for (const status of locked) {
      expect(canEditPost('AUTHOR', 7, 7, status), status).toBe(false);
    }
  });

  it('never lets an author edit another author’s draft', () => {
    expect(canEditPost('AUTHOR', 7, 8, 'DRAFT')).toBe(false);
  });
});

describe('canViewRevisions', () => {
  it('follows the same rule as reading the post', () => {
    expect(canViewRevisions('AUTHOR', 5, 5)).toBe(true);
    expect(canViewRevisions('AUTHOR', 5, 6)).toBe(false);
    expect(canViewRevisions('EDITOR', 5, 6)).toBe(true);
  });
});

describe('canEditMedia', () => {
  it('lets uploaders edit their own asset and staff edit any', () => {
    expect(canEditMedia('AUTHOR', 3, 3)).toBe(true);
    expect(canEditMedia('AUTHOR', 3, 4)).toBe(false);
    expect(canEditMedia('EDITOR', 3, 4)).toBe(true);
    expect(canEditMedia('ADMIN', 3, 4)).toBe(true);
  });
});
