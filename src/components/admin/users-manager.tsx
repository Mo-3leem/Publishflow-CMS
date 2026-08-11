'use client';

import * as React from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Pencil, KeyRound, Users as UsersIcon, Search } from 'lucide-react';
import type { SafeUser, UserRole, UserStatus, Principal } from '@/lib/domain';
import { USER_ROLES, USER_ROLE_LABELS, MIN_PASSWORD_LENGTH } from '@/lib/domain';
import { api, apiList, ApiError } from '@/client/api-client';
import { queryKeys } from '@/client/query-keys';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { Card, EmptyState, Alert, TableSkeleton } from '@/components/ui/surfaces';
import { Dialog } from '@/components/ui/dialog';
import { RoleBadge, UserStatusBadge } from '@/components/ui/status-badge';
import { formatInTimezone } from '@/lib/datetime';

/**
 * User administration (Admin only).
 *
 * The "last active administrator" safeguard is enforced transactionally by the
 * server; this screen explains it up front and surfaces the 409 clearly rather
 * than presenting it as a generic failure.
 */
export function UsersManager({
  currentUser,
  timezone,
}: {
  currentUser: Principal;
  timezone: string;
}) {
  const [search, setSearch] = React.useState('');
  const [roleFilter, setRoleFilter] = React.useState<UserRole | ''>('');
  const [statusFilter, setStatusFilter] = React.useState<UserStatus | ''>('');
  const [creating, setCreating] = React.useState(false);
  const [editing, setEditing] = React.useState<SafeUser | null>(null);
  const [resetting, setResetting] = React.useState<SafeUser | null>(null);

  const query = new URLSearchParams();
  if (search.trim()) query.set('q', search.trim());
  if (roleFilter) query.set('role', roleFilter);
  if (statusFilter) query.set('status', statusFilter);
  query.set('pageSize', '50');
  const queryText = query.toString();

  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.users.list(queryText),
    queryFn: () => apiList<SafeUser>(`/users?${queryText}`),
  });

  const users = data?.data ?? [];
  const activeAdmins = users.filter(
    (user) => user.role === 'ADMIN' && user.status === 'ACTIVE',
  ).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-ink-900 text-2xl font-bold tracking-tight">Users</h1>
          <p className="text-ink-500 mt-1 text-sm">
            Staff accounts. There is no public registration — an administrator creates every
            account.
          </p>
        </div>
        <Button type="button" onClick={() => setCreating(true)}>
          <Plus aria-hidden="true" className="h-4 w-4" />
          New user
        </Button>
      </div>

      <Alert tone="info" title="Administrator safeguard">
        The last active administrator cannot be disabled or demoted, because that would leave nobody
        able to manage users or settings. Promote a second administrator first.
      </Alert>

      <div className="border-ink-200 grid gap-3 rounded-xl border bg-white p-3 sm:grid-cols-3">
        <div className="relative">
          <label htmlFor="user-search" className="sr-only">
            Search users
          </label>
          <Search
            aria-hidden="true"
            className="text-ink-400 pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
          />
          <Input
            id="user-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name or email…"
            className="pl-9"
          />
        </div>

        <div>
          <label htmlFor="user-role" className="sr-only">
            Filter by role
          </label>
          <Select
            id="user-role"
            value={roleFilter}
            onChange={(event) => setRoleFilter(event.target.value as UserRole | '')}
          >
            <option value="">All roles</option>
            {USER_ROLES.map((role) => (
              <option key={role} value={role}>
                {USER_ROLE_LABELS[role]}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <label htmlFor="user-status" className="sr-only">
            Filter by status
          </label>
          <Select
            id="user-status"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as UserStatus | '')}
          >
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="DISABLED">Disabled</option>
          </Select>
        </div>
      </div>

      <Card className="overflow-hidden">
        {isError ? (
          <div className="p-5">
            <Alert tone="error">Could not load users.</Alert>
          </div>
        ) : isLoading ? (
          <TableSkeleton rows={4} columns={5} />
        ) : users.length === 0 ? (
          <EmptyState icon={UsersIcon} title="No users match these filters" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] text-sm">
              <thead>
                <tr className="border-ink-200 bg-ink-50 border-b text-left">
                  <th
                    scope="col"
                    className="text-ink-500 px-4 py-2.5 text-xs font-semibold tracking-wide uppercase"
                  >
                    Name
                  </th>
                  <th
                    scope="col"
                    className="text-ink-500 px-4 py-2.5 text-xs font-semibold tracking-wide uppercase"
                  >
                    Role
                  </th>
                  <th
                    scope="col"
                    className="text-ink-500 px-4 py-2.5 text-xs font-semibold tracking-wide uppercase"
                  >
                    Status
                  </th>
                  <th
                    scope="col"
                    className="text-ink-500 px-4 py-2.5 text-xs font-semibold tracking-wide uppercase"
                  >
                    Last sign-in
                  </th>
                  <th
                    scope="col"
                    className="text-ink-500 px-4 py-2.5 text-right text-xs font-semibold tracking-wide uppercase"
                  >
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-ink-200 divide-y">
                {users.map((user) => (
                  <tr key={user.id} className="hover:bg-ink-50/60">
                    <th scope="row" className="px-4 py-3 text-left font-normal">
                      <span className="text-ink-900 block font-medium">
                        {user.name}
                        {user.id === currentUser.id ? (
                          <span className="bg-brand-100 text-brand-800 ml-2 rounded px-1.5 py-0.5 text-xs font-medium">
                            You
                          </span>
                        ) : null}
                      </span>
                      <span className="text-ink-500 block text-xs">{user.email}</span>
                    </th>
                    <td className="px-4 py-3">
                      <RoleBadge role={user.role} />
                    </td>
                    <td className="px-4 py-3">
                      <UserStatusBadge status={user.status} />
                    </td>
                    <td className="text-ink-600 px-4 py-3 whitespace-nowrap">
                      {user.lastLoginAt ? formatInTimezone(user.lastLoginAt, timezone) : 'Never'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditing(user)}
                        >
                          <Pencil aria-hidden="true" className="h-4 w-4" />
                          Edit
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setResetting(user)}
                        >
                          <KeyRound aria-hidden="true" className="h-4 w-4" />
                          <span className="sr-only">Reset password for {user.name}</span>
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Mounted only while open, and keyed by target, so each opening starts
          from freshly initialised state rather than a reset effect. */}
      {creating ? <CreateUserDialog onClose={() => setCreating(false)} /> : null}

      {editing ? (
        <EditUserDialog
          key={editing.id}
          user={editing}
          onClose={() => setEditing(null)}
          isLastActiveAdmin={
            editing.role === 'ADMIN' && editing.status === 'ACTIVE' && activeAdmins <= 1
          }
        />
      ) : null}

      {resetting ? (
        <ResetPasswordDialog
          key={resetting.id}
          user={resetting}
          onClose={() => setResetting(null)}
        />
      ) : null}
    </div>
  );
}

/** Mounted only while open (see the call site), so state initialises fresh. */
function CreateUserDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [role, setRole] = React.useState<UserRole>('AUTHOR');
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});
  const [formError, setFormError] = React.useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      api.post<SafeUser>('/users', {
        name: name.trim(),
        email: email.trim(),
        password,
        role,
      }),
    onSuccess: async () => {
      toast.success('User created.');
      await queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
      onClose();
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError) {
        const fields = error.fieldErrors();
        setErrors(Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, [v]])));
        setFormError(Object.keys(fields).length > 0 ? null : error.message);
      } else {
        setFormError('Could not create this user.');
      }
    },
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title="New user"
      description="The account is active immediately. Share the temporary password over a secure channel."
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            loading={create.isPending}
            disabled={!name.trim() || !email.trim() || password.length < MIN_PASSWORD_LENGTH}
            onClick={() => create.mutate()}
          >
            Create user
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {formError ? <Alert tone="error">{formError}</Alert> : null}

        <Field label="Full name" htmlFor="new-name" required error={errors.name}>
          <Input
            id="new-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={100}
            invalid={Boolean(errors.name)}
            autoComplete="off"
          />
        </Field>

        <Field label="Email address" htmlFor="new-email" required error={errors.email}>
          <Input
            id="new-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            invalid={Boolean(errors.email)}
            autoComplete="off"
          />
        </Field>

        <Field
          label="Temporary password"
          htmlFor="new-password"
          required
          error={errors.password}
          hint={`At least ${MIN_PASSWORD_LENGTH} characters. Stored only as an Argon2id hash.`}
          counter={`${password.length} / ${MIN_PASSWORD_LENGTH} min`}
        >
          <Input
            id="new-password"
            type="text"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            invalid={Boolean(errors.password)}
            autoComplete="new-password"
          />
        </Field>

        <Field label="Role" htmlFor="new-role" required error={errors.role}>
          <Select
            id="new-role"
            value={role}
            onChange={(event) => setRole(event.target.value as UserRole)}
          >
            {USER_ROLES.map((value) => (
              <option key={value} value={value}>
                {USER_ROLE_LABELS[value]}
              </option>
            ))}
          </Select>
        </Field>

        <p className="bg-ink-50 text-ink-600 rounded-lg p-3 text-xs">
          <strong className="text-ink-800 font-medium">Authors</strong> write and submit their own
          drafts. <strong className="text-ink-800 font-medium">Editors</strong> also review, publish
          and manage categories, menus and media.{' '}
          <strong className="text-ink-800 font-medium">Administrators</strong> additionally manage
          users, settings and the audit log.
        </p>
      </div>
    </Dialog>
  );
}

/** Mounted per user (keyed at the call site), so state initialises fresh. */
function EditUserDialog({
  user,
  onClose,
  isLastActiveAdmin,
}: {
  user: SafeUser;
  onClose: () => void;
  isLastActiveAdmin: boolean;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = React.useState(user.name);
  const [role, setRole] = React.useState<UserRole>(user.role);
  const [status, setStatus] = React.useState<UserStatus>(user.status);
  const [formError, setFormError] = React.useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => api.patch<SafeUser>(`/users/${user.id}`, { name: name.trim(), role, status }),
    onSuccess: async () => {
      toast.success('User updated.');
      await queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
      onClose();
    },
    onError: (error: unknown) => {
      setFormError(error instanceof ApiError ? error.message : 'Could not update this user.');
    },
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Edit ${user.name}`}
      description={user.email}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            loading={save.isPending}
            disabled={name.trim().length < 2}
            onClick={() => save.mutate()}
          >
            Save changes
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {formError ? <Alert tone="error">{formError}</Alert> : null}

        {isLastActiveAdmin ? (
          <Alert tone="warning">
            This is the only active administrator. Changing the role or disabling the account will
            be refused by the server until another administrator exists.
          </Alert>
        ) : null}

        <Field label="Full name" htmlFor="edit-name" required>
          <Input
            id="edit-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={100}
          />
        </Field>

        <Field label="Role" htmlFor="edit-role" required>
          <Select
            id="edit-role"
            value={role}
            onChange={(event) => setRole(event.target.value as UserRole)}
          >
            {USER_ROLES.map((value) => (
              <option key={value} value={value}>
                {USER_ROLE_LABELS[value]}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Account status"
          htmlFor="edit-status"
          required
          hint="Disabling an account immediately revokes every active session for that user."
        >
          <Select
            id="edit-status"
            value={status}
            onChange={(event) => setStatus(event.target.value as UserStatus)}
          >
            <option value="ACTIVE">Active</option>
            <option value="DISABLED">Disabled</option>
          </Select>
        </Field>
      </div>
    </Dialog>
  );
}

/** Mounted per user (keyed at the call site), so state initialises fresh. */
function ResetPasswordDialog({ user, onClose }: { user: SafeUser; onClose: () => void }) {
  const [password, setPassword] = React.useState('');
  const [formError, setFormError] = React.useState<string | null>(null);

  const reset = useMutation({
    mutationFn: () => api.post(`/users/${user.id}/reset-password`, { newPassword: password }),
    onSuccess: () => {
      toast.success('Password reset. All of that user’s sessions were revoked.');
      onClose();
    },
    onError: (error: unknown) => {
      setFormError(error instanceof ApiError ? error.message : 'Could not reset the password.');
    },
  });

  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={`Reset password for ${user.name}`}
      description="Every active session for this user is revoked immediately."
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            loading={reset.isPending}
            disabled={password.length < MIN_PASSWORD_LENGTH}
            onClick={() => reset.mutate()}
          >
            Reset password
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {formError ? <Alert tone="error">{formError}</Alert> : null}

        <Field
          label="New temporary password"
          htmlFor="reset-password"
          required
          hint={`At least ${MIN_PASSWORD_LENGTH} characters. Share it over a secure channel and ask the user to change it.`}
          counter={`${password.length} / ${MIN_PASSWORD_LENGTH} min`}
        >
          <Input
            id="reset-password"
            type="text"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
          />
        </Field>
      </div>
    </Dialog>
  );
}
