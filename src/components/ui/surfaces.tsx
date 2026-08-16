import * as React from 'react';
import { AlertCircle, CheckCircle2, Info, TriangleAlert, Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Card, alert, empty state and skeleton primitives. */

export function Card({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'border-ink-200 shadow-raised rounded-[var(--radius-surface)] border bg-white',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'border-ink-200 flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4',
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="text-ink-900 text-base font-semibold">{title}</h2>
        {description ? <p className="text-ink-500 mt-0.5 text-sm">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

type AlertTone = 'info' | 'success' | 'warning' | 'error';

const ALERT_STYLES: Record<
  AlertTone,
  { className: string; Icon: React.ElementType; label: string }
> = {
  info: {
    className: 'bg-brand-50 text-brand-900 border-brand-200',
    Icon: Info,
    label: 'Information',
  },
  success: {
    className: 'bg-emerald-50 text-emerald-900 border-emerald-200',
    Icon: CheckCircle2,
    label: 'Success',
  },
  warning: {
    className: 'bg-amber-50 text-amber-900 border-amber-200',
    Icon: TriangleAlert,
    label: 'Warning',
  },
  error: { className: 'bg-red-50 text-red-900 border-red-200', Icon: AlertCircle, label: 'Error' },
};

export function Alert({
  tone = 'info',
  title,
  children,
  className,
  action,
}: {
  tone?: AlertTone;
  title?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
}) {
  const style = ALERT_STYLES[tone];
  const Icon = style.Icon;
  return (
    <div
      // Errors and warnings interrupt; info/success are announced politely.
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('flex gap-3 rounded-lg border p-3.5 text-sm', style.className, className)}
    >
      <Icon aria-hidden="true" className="mt-0.5 h-4.5 w-4.5 shrink-0" />
      <div className="min-w-0 flex-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={cn(title && 'mt-0.5')}>{children}</div> : null}
        {action ? <div className="mt-2.5">{action}</div> : null}
      </div>
      <span className="sr-only">{style.label}</span>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon: Icon = Inbox,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  icon?: React.ElementType;
  className?: string;
}) {
  return (
    <div className={cn('px-6 py-14 text-center', className)}>
      <div className="bg-ink-100 mx-auto flex h-11 w-11 items-center justify-center rounded-full">
        <Icon aria-hidden="true" className="text-ink-500 h-5 w-5" />
      </div>
      <h3 className="text-ink-900 mt-3.5 text-sm font-semibold">{title}</h3>
      {description ? (
        <div className="text-ink-500 mx-auto mt-1 max-w-md text-sm">{description}</div>
      ) : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn('bg-ink-200/70 animate-pulse rounded', className)} />
  );
}

export function TableSkeleton({ rows = 5, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="divide-ink-200 divide-y" aria-hidden="true">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex gap-4 px-5 py-3.5">
          {Array.from({ length: columns }).map((__, columnIndex) => (
            <Skeleton
              key={columnIndex}
              className={cn('h-4', columnIndex === 0 ? 'flex-[3]' : 'flex-1')}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Screen-reader-only live region for async status updates. */
export function LiveRegion({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" aria-live="polite" className="sr-only">
      {children}
    </div>
  );
}
