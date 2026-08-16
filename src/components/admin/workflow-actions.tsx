'use client';

import * as React from 'react';
import { toast } from 'sonner';
import {
  Send,
  RotateCcw,
  CheckCircle2,
  CalendarClock,
  XCircle,
  Archive,
  Undo2,
} from 'lucide-react';
import type { PostDetail } from '@/server/services/post-service';
import type { Principal } from '@/lib/domain';
import { availableActions, WORKFLOW_ACTION_LABELS, type WorkflowAction } from '@/lib/workflow';
import { api, ApiError } from '@/client/api-client';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Textarea, Input } from '@/components/ui/field';
import { Alert } from '@/components/ui/surfaces';
import { fromDateTimeLocalValue, toDateTimeLocalValue } from '@/lib/datetime';

/**
 * Workflow buttons for the post editor.
 *
 * The set shown is derived from the same state machine the server uses. It is a
 * usability affordance only — the API re-checks the transition and the role.
 */

const ICONS: Record<WorkflowAction, React.ElementType> = {
  submit: Send,
  'request-changes': RotateCcw,
  publish: CheckCircle2,
  schedule: CalendarClock,
  'cancel-schedule': XCircle,
  archive: Archive,
  'restore-draft': Undo2,
};

const VARIANTS: Record<WorkflowAction, 'primary' | 'outline' | 'danger'> = {
  submit: 'primary',
  'request-changes': 'outline',
  publish: 'primary',
  schedule: 'outline',
  'cancel-schedule': 'outline',
  archive: 'danger',
  'restore-draft': 'outline',
};

/**
 * One sentence describing the next editorial step, written for the person who
 * can actually take it — an author sees "submit", an editor sees "publish or
 * send back".
 */
function nextStepHint(status: PostDetail['status'], actions: WorkflowAction[]): string {
  if (actions.includes('submit')) {
    return 'This is a draft. Submit it for review when you are ready for an editor to look at it.';
  }
  if (actions.includes('publish') && actions.includes('request-changes')) {
    return 'Waiting for your review. Publish it, schedule it for later, or send it back with a note.';
  }
  if (actions.includes('publish')) {
    return 'Scheduled to publish automatically. You can publish it now instead, or cancel the schedule.';
  }
  if (actions.includes('archive')) {
    return 'Live on the public site. Archiving removes it from the site but keeps its history.';
  }
  if (actions.includes('restore-draft')) {
    return 'Archived and hidden from the public site. Restoring returns it to draft for editing.';
  }
  return `This post is ${status.replace('_', ' ').toLowerCase()}.`;
}

/** Actions that need extra input before they can run. */
const NEEDS_DIALOG: Record<WorkflowAction, boolean> = {
  submit: false,
  'request-changes': true,
  publish: false,
  schedule: true,
  'cancel-schedule': false,
  archive: true,
  'restore-draft': false,
};

export function WorkflowActions({
  post,
  user,
  timezone,
  dirty,
  onSuccess,
}: {
  post: PostDetail;
  user: Principal;
  timezone: string;
  dirty: boolean;
  onSuccess: (post: PostDetail) => void;
}) {
  const [pending, setPending] = React.useState<WorkflowAction | null>(null);
  const [dialogAction, setDialogAction] = React.useState<WorkflowAction | null>(null);
  const [comment, setComment] = React.useState('');
  const [scheduledAt, setScheduledAt] = React.useState(() =>
    toDateTimeLocalValue(post.scheduledAt, timezone),
  );
  const [error, setError] = React.useState<string | null>(null);

  const actions = availableActions(post.status, user.role, post.authorId === user.id);

  const run = async (action: WorkflowAction) => {
    setPending(action);
    setError(null);

    try {
      const body: Record<string, unknown> = { expectedVersion: post.version };

      if (action === 'request-changes' || action === 'archive') {
        if (comment.trim()) body.comment = comment.trim();
      }
      if (action === 'schedule') {
        const iso = fromDateTimeLocalValue(scheduledAt, timezone);
        if (!iso) {
          setError('Choose a valid date and time.');
          setPending(null);
          return;
        }
        body.scheduledAt = iso;
      }

      const updated = await api.post<PostDetail>(`/posts/${post.id}/${action}`, body);
      toast.success(`${WORKFLOW_ACTION_LABELS[action]} completed.`);
      setDialogAction(null);
      setComment('');
      onSuccess(updated);
    } catch (caught) {
      const message =
        caught instanceof ApiError ? caught.message : 'The action failed. Please try again.';
      setError(message);
      // Errors raised from a dialog stay in the dialog; otherwise toast them.
      if (!dialogAction) toast.error(message);
    } finally {
      setPending(null);
    }
  };

  const onClick = (action: WorkflowAction) => {
    setError(null);
    if (NEEDS_DIALOG[action]) {
      setDialogAction(action);
      return;
    }
    void run(action);
  };

  if (actions.length === 0) {
    return (
      <div className="border-ink-200 bg-ink-50 rounded-[var(--radius-control)] border p-3">
        <p className="text-ink-600 text-sm">
          This post is {post.status.replace('_', ' ').toLowerCase()} and there is nothing for you to
          do here.{' '}
          {post.status === 'IN_REVIEW'
            ? 'An editor will review it next.'
            : 'An editor or administrator can move it on.'}
        </p>
      </div>
    );
  }

  // The single action that advances the editorial flow gets primary weight;
  // everything else steps back. `availableActions` already returns them in
  // lifecycle order, so the first is the forward one.
  const [primary, ...secondary] = actions;

  return (
    <div className="space-y-3">
      {/* Says what happens next in plain language, so a non-technical user is
          not left inferring the workflow from button labels alone. */}
      <p className="text-ink-600 text-sm">{nextStepHint(post.status, actions)}</p>

      {dirty ? (
        <Alert tone="warning">
          You have unsaved changes. Save them first — workflow actions operate on the version
          already stored on the server.
        </Alert>
      ) : null}

      {error && !dialogAction ? <Alert tone="error">{error}</Alert> : null}

      {primary ? (
        <Button
          type="button"
          variant={VARIANTS[primary]}
          className="w-full"
          disabled={dirty || (pending !== null && pending !== primary)}
          loading={pending === primary}
          onClick={() => onClick(primary)}
        >
          {pending !== primary
            ? (() => {
                const Icon = ICONS[primary];
                return <Icon aria-hidden="true" className="h-4 w-4" />;
              })()
            : null}
          {WORKFLOW_ACTION_LABELS[primary]}
        </Button>
      ) : null}

      {secondary.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {secondary.map((action) => {
            const Icon = ICONS[action];
            return (
              <Button
                key={action}
                type="button"
                variant={VARIANTS[action] === 'primary' ? 'outline' : VARIANTS[action]}
                size="sm"
                disabled={dirty || (pending !== null && pending !== action)}
                loading={pending === action}
                onClick={() => onClick(action)}
              >
                {pending !== action ? <Icon aria-hidden="true" className="h-4 w-4" /> : null}
                {WORKFLOW_ACTION_LABELS[action]}
              </Button>
            );
          })}
        </div>
      ) : null}

      <Dialog
        open={dialogAction === 'request-changes'}
        onClose={() => setDialogAction(null)}
        title="Request changes"
        description="The author will see this note and the post returns to draft."
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setDialogAction(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              loading={pending === 'request-changes'}
              onClick={() => void run('request-changes')}
            >
              Send back to draft
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {error ? <Alert tone="error">{error}</Alert> : null}
          <Field
            label="Review note"
            htmlFor="review-comment"
            required
            hint="Between 3 and 2000 characters. Explain what needs to change."
            counter={`${comment.length} / 2000`}
          >
            <Textarea
              id="review-comment"
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              maxLength={2000}
              rows={5}
              placeholder="The second section needs a source link before this can go live."
            />
          </Field>
        </div>
      </Dialog>

      <Dialog
        open={dialogAction === 'schedule'}
        onClose={() => setDialogAction(null)}
        title="Schedule publication"
        description={`Times are entered in the site timezone (${timezone}) and stored as UTC.`}
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setDialogAction(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              loading={pending === 'schedule'}
              onClick={() => void run('schedule')}
            >
              Schedule
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {error ? <Alert tone="error">{error}</Alert> : null}
          <Field
            label="Publish at"
            htmlFor="scheduled-at"
            required
            hint="Must be in the future. The publishing job will pick it up automatically."
          >
            <Input
              id="scheduled-at"
              type="datetime-local"
              value={scheduledAt}
              onChange={(event) => setScheduledAt(event.target.value)}
            />
          </Field>
        </div>
      </Dialog>

      <Dialog
        open={dialogAction === 'archive'}
        onClose={() => setDialogAction(null)}
        title="Archive this post?"
        description="It will be removed from the public site. History and revisions are kept."
        size="sm"
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setDialogAction(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              loading={pending === 'archive'}
              onClick={() => void run('archive')}
            >
              Archive
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {error ? <Alert tone="error">{error}</Alert> : null}
          <Field
            label="Reason (optional)"
            htmlFor="archive-comment"
            counter={`${comment.length} / 2000`}
          >
            <Textarea
              id="archive-comment"
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              maxLength={2000}
              rows={3}
              placeholder="Superseded by the 2026 guide."
            />
          </Field>
        </div>
      </Dialog>
    </div>
  );
}
