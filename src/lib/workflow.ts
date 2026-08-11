import type { PostStatus, UserRole } from './domain';

/**
 * Post lifecycle state machine.
 *
 * Pure data + pure predicates so the whole matrix is unit-testable without a
 * database. The API layer never decides transitions; it delegates here.
 */

export const WORKFLOW_ACTIONS = [
  'submit',
  'request-changes',
  'publish',
  'schedule',
  'cancel-schedule',
  'archive',
  'restore-draft',
] as const;

export type WorkflowAction = (typeof WORKFLOW_ACTIONS)[number];

export interface TransitionRule {
  action: WorkflowAction;
  from: readonly PostStatus[];
  to: PostStatus;
  /** Roles that may perform it regardless of ownership. */
  roles: readonly UserRole[];
  /** When true, an AUTHOR may perform it on a post they own. */
  ownerAllowed: boolean;
  requiresComment: boolean;
  requiresScheduledAt: boolean;
}

export const TRANSITIONS: readonly TransitionRule[] = [
  {
    action: 'submit',
    from: ['DRAFT'],
    to: 'IN_REVIEW',
    roles: ['ADMIN', 'EDITOR'],
    ownerAllowed: true,
    requiresComment: false,
    requiresScheduledAt: false,
  },
  {
    action: 'request-changes',
    from: ['IN_REVIEW'],
    to: 'DRAFT',
    roles: ['ADMIN', 'EDITOR'],
    ownerAllowed: false,
    requiresComment: true,
    requiresScheduledAt: false,
  },
  {
    action: 'publish',
    from: ['IN_REVIEW', 'SCHEDULED'],
    to: 'PUBLISHED',
    roles: ['ADMIN', 'EDITOR'],
    ownerAllowed: false,
    requiresComment: false,
    requiresScheduledAt: false,
  },
  {
    action: 'schedule',
    from: ['IN_REVIEW'],
    to: 'SCHEDULED',
    roles: ['ADMIN', 'EDITOR'],
    ownerAllowed: false,
    requiresComment: false,
    requiresScheduledAt: true,
  },
  {
    action: 'cancel-schedule',
    from: ['SCHEDULED'],
    to: 'DRAFT',
    roles: ['ADMIN', 'EDITOR'],
    ownerAllowed: false,
    requiresComment: false,
    requiresScheduledAt: false,
  },
  {
    action: 'archive',
    from: ['PUBLISHED'],
    to: 'ARCHIVED',
    roles: ['ADMIN', 'EDITOR'],
    ownerAllowed: false,
    requiresComment: false,
    requiresScheduledAt: false,
  },
  {
    action: 'restore-draft',
    from: ['ARCHIVED'],
    to: 'DRAFT',
    roles: ['ADMIN', 'EDITOR'],
    ownerAllowed: false,
    requiresComment: false,
    requiresScheduledAt: false,
  },
] as const;

export function getTransition(action: WorkflowAction): TransitionRule {
  const rule = TRANSITIONS.find((t) => t.action === action);
  if (!rule) throw new Error(`Unknown workflow action: ${action}`);
  return rule;
}

/** Is this status change legal, ignoring who is asking? */
export function isTransitionAllowed(action: WorkflowAction, from: PostStatus): boolean {
  return getTransition(action).from.includes(from);
}

/** May this actor perform the action, given role and ownership? */
export function canPerformTransition(
  action: WorkflowAction,
  role: UserRole,
  isOwner: boolean,
): boolean {
  const rule = getTransition(action);
  if (rule.roles.includes(role)) return true;
  return rule.ownerAllowed && isOwner;
}

/** Actions offered in the UI for the current post state and actor. */
export function availableActions(
  status: PostStatus,
  role: UserRole,
  isOwner: boolean,
): WorkflowAction[] {
  return TRANSITIONS.filter(
    (rule) => rule.from.includes(status) && canPerformTransition(rule.action, role, isOwner),
  ).map((rule) => rule.action);
}

export const WORKFLOW_ACTION_LABELS: Record<WorkflowAction, string> = {
  submit: 'Submit for review',
  'request-changes': 'Request changes',
  publish: 'Publish',
  schedule: 'Schedule',
  'cancel-schedule': 'Cancel schedule',
  archive: 'Archive',
  'restore-draft': 'Restore to draft',
};
