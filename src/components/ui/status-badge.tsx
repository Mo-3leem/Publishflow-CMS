import * as React from 'react';
import {
  CircleDashed,
  Clock3,
  Eye,
  CheckCircle2,
  Archive,
  ShieldCheck,
  PenLine,
  UserCheck,
} from 'lucide-react';
import {
  POST_STATUS_LABELS,
  USER_ROLE_LABELS,
  type PostStatus,
  type UserRole,
  type UserStatus,
} from '@/lib/domain';
import { cn } from '@/lib/utils';

/**
 * Status pills.
 *
 * Each variant pairs a colour with a distinct icon and a text label, so status
 * is never communicated by colour alone.
 */

const POST_STYLES: Record<PostStatus, { className: string; Icon: React.ElementType }> = {
  DRAFT: { className: 'bg-ink-100 text-ink-700 ring-ink-200', Icon: CircleDashed },
  IN_REVIEW: { className: 'bg-amber-50 text-amber-800 ring-amber-200', Icon: Eye },
  SCHEDULED: { className: 'bg-violet-50 text-violet-800 ring-violet-200', Icon: Clock3 },
  PUBLISHED: { className: 'bg-emerald-50 text-emerald-800 ring-emerald-200', Icon: CheckCircle2 },
  ARCHIVED: { className: 'bg-ink-200 text-ink-700 ring-ink-300', Icon: Archive },
};

export function PostStatusBadge({ status, className }: { status: PostStatus; className?: string }) {
  const style = POST_STYLES[status];
  const Icon = style.Icon;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap ring-1 ring-inset',
        style.className,
        className,
      )}
    >
      <Icon aria-hidden="true" className="h-3.5 w-3.5" />
      {POST_STATUS_LABELS[status]}
    </span>
  );
}

const ROLE_STYLES: Record<UserRole, { className: string; Icon: React.ElementType }> = {
  ADMIN: { className: 'bg-brand-50 text-brand-800 ring-brand-200', Icon: ShieldCheck },
  EDITOR: { className: 'bg-teal-50 text-teal-800 ring-teal-200', Icon: UserCheck },
  AUTHOR: { className: 'bg-ink-100 text-ink-700 ring-ink-200', Icon: PenLine },
};

export function RoleBadge({ role, className }: { role: UserRole; className?: string }) {
  const style = ROLE_STYLES[role];
  const Icon = style.Icon;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap ring-1 ring-inset',
        style.className,
        className,
      )}
    >
      <Icon aria-hidden="true" className="h-3.5 w-3.5" />
      {USER_ROLE_LABELS[role]}
    </span>
  );
}

export function UserStatusBadge({ status }: { status: UserStatus }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset',
        status === 'ACTIVE'
          ? 'bg-emerald-50 text-emerald-800 ring-emerald-200'
          : 'bg-red-50 text-red-800 ring-red-200',
      )}
    >
      <span aria-hidden="true">{status === 'ACTIVE' ? '●' : '○'}</span>
      {status === 'ACTIVE' ? 'Active' : 'Disabled'}
    </span>
  );
}
