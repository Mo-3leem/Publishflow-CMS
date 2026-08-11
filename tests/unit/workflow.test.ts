import { describe, expect, it } from 'vitest';
import {
  availableActions,
  canPerformTransition,
  getTransition,
  isTransitionAllowed,
  TRANSITIONS,
  WORKFLOW_ACTIONS,
  type WorkflowAction,
} from '@/lib/workflow';
import { POST_STATUSES, USER_ROLES, type PostStatus } from '@/lib/domain';

describe('workflow transition table', () => {
  it('covers every action exactly once', () => {
    expect(TRANSITIONS).toHaveLength(WORKFLOW_ACTIONS.length);
    const actions = TRANSITIONS.map((rule) => rule.action).sort();
    expect(actions).toEqual([...WORKFLOW_ACTIONS].sort());
  });

  it('matches the specification state diagram', () => {
    const expected: Record<WorkflowAction, { from: PostStatus[]; to: PostStatus }> = {
      submit: { from: ['DRAFT'], to: 'IN_REVIEW' },
      'request-changes': { from: ['IN_REVIEW'], to: 'DRAFT' },
      publish: { from: ['IN_REVIEW', 'SCHEDULED'], to: 'PUBLISHED' },
      schedule: { from: ['IN_REVIEW'], to: 'SCHEDULED' },
      'cancel-schedule': { from: ['SCHEDULED'], to: 'DRAFT' },
      archive: { from: ['PUBLISHED'], to: 'ARCHIVED' },
      'restore-draft': { from: ['ARCHIVED'], to: 'DRAFT' },
    };

    for (const [action, shape] of Object.entries(expected) as Array<
      [WorkflowAction, { from: PostStatus[]; to: PostStatus }]
    >) {
      const rule = getTransition(action);
      expect([...rule.from].sort(), action).toEqual([...shape.from].sort());
      expect(rule.to, action).toBe(shape.to);
    }
  });
});

describe('isTransitionAllowed', () => {
  it('accepts exactly the legal source states and rejects every other one', () => {
    for (const action of WORKFLOW_ACTIONS) {
      const rule = getTransition(action);
      for (const status of POST_STATUSES) {
        const allowed = rule.from.includes(status);
        expect(isTransitionAllowed(action, status), `${action} from ${status}`).toBe(allowed);
      }
    }
  });

  it('rejects the specific illegal jumps called out in the specification', () => {
    expect(isTransitionAllowed('publish', 'DRAFT')).toBe(false);
    expect(isTransitionAllowed('archive', 'DRAFT')).toBe(false);
    expect(isTransitionAllowed('submit', 'PUBLISHED')).toBe(false);
    expect(isTransitionAllowed('schedule', 'DRAFT')).toBe(false);
    expect(isTransitionAllowed('restore-draft', 'PUBLISHED')).toBe(false);
  });
});

describe('canPerformTransition', () => {
  it('lets the owning author submit their own draft only', () => {
    expect(canPerformTransition('submit', 'AUTHOR', true)).toBe(true);
    expect(canPerformTransition('submit', 'AUTHOR', false)).toBe(false);
  });

  it('never lets an author publish, schedule, archive or request changes', () => {
    const forbidden: WorkflowAction[] = [
      'publish',
      'schedule',
      'archive',
      'request-changes',
      'cancel-schedule',
      'restore-draft',
    ];
    for (const action of forbidden) {
      expect(canPerformTransition(action, 'AUTHOR', true), `owner ${action}`).toBe(false);
      expect(canPerformTransition(action, 'AUTHOR', false), `non-owner ${action}`).toBe(false);
    }
  });

  it('lets editors and admins perform every action', () => {
    for (const action of WORKFLOW_ACTIONS) {
      for (const role of ['ADMIN', 'EDITOR'] as const) {
        expect(canPerformTransition(action, role, false), `${role} ${action}`).toBe(true);
      }
    }
  });
});

describe('availableActions', () => {
  it('offers an author only "submit" on their own draft', () => {
    expect(availableActions('DRAFT', 'AUTHOR', true)).toEqual(['submit']);
  });

  it('offers an author nothing once the post is in review', () => {
    expect(availableActions('IN_REVIEW', 'AUTHOR', true)).toEqual([]);
  });

  it('offers an editor the full review set on an in-review post', () => {
    expect(availableActions('IN_REVIEW', 'EDITOR', false).sort()).toEqual(
      ['publish', 'request-changes', 'schedule'].sort(),
    );
  });

  it('offers only archive on a published post', () => {
    expect(availableActions('PUBLISHED', 'ADMIN', false)).toEqual(['archive']);
  });

  it('offers nothing to any role on a status with no outgoing edges for them', () => {
    for (const role of USER_ROLES) {
      const actions = availableActions('ARCHIVED', role, false);
      expect(actions).toEqual(role === 'AUTHOR' ? [] : ['restore-draft']);
    }
  });
});

describe('required extra data', () => {
  it('requires a comment only for request-changes', () => {
    for (const action of WORKFLOW_ACTIONS) {
      expect(getTransition(action).requiresComment, action).toBe(action === 'request-changes');
    }
  });

  it('requires a scheduled date only for schedule', () => {
    for (const action of WORKFLOW_ACTIONS) {
      expect(getTransition(action).requiresScheduledAt, action).toBe(action === 'schedule');
    }
  });
});
