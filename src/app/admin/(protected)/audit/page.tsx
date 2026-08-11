import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ScrollText } from 'lucide-react';
import { getCurrentUser } from '@/server/auth/current-user';
import { listAuditFacets, listAuditLogs, auditActionLabel } from '@/server/services/audit-service';
import { getPublicSettings } from '@/server/services/settings-service';
import { can } from '@/lib/permissions';
import { Card, EmptyState, Alert } from '@/components/ui/surfaces';
import { Pagination } from '@/components/ui/pagination';
import { formatInTimezone } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Audit log' };

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AuditPage({ searchParams }: PageProps) {
  const user = await getCurrentUser();
  if (!user) redirect('/admin/login');

  if (!can(user.role, 'audit.view')) {
    return (
      <div className="mx-auto max-w-2xl">
        <Alert tone="error" title="Not available">
          Only administrators can read the audit log.
        </Alert>
      </div>
    );
  }

  const params = await searchParams;
  const action = single(params.action);
  const entityType = single(params.entityType);
  const from = single(params.from);
  const to = single(params.to);
  const page = single(params.page);

  const { data, meta } = listAuditLogs(user, {
    page,
    action: action ?? null,
    entityType: entityType ?? null,
    // Dates arrive as YYYY-MM-DD; widen them to cover the whole day in UTC.
    from: from ? `${from}T00:00:00.000Z` : null,
    to: to ? `${to}T23:59:59.999Z` : null,
  });

  const facets = listAuditFacets(user);
  const { timezone } = getPublicSettings();

  const buildHref = (overrides: Record<string, string | undefined>) => {
    const search = new URLSearchParams();
    const current: Record<string, string | undefined> = {
      action,
      entityType,
      from,
      to,
      page,
      ...overrides,
    };
    for (const [key, value] of Object.entries(current)) {
      if (value) search.set(key, value);
    }
    const qs = search.toString();
    return qs ? `/admin/audit?${qs}` : '/admin/audit';
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div>
        <h1 className="text-ink-900 text-2xl font-bold tracking-tight">Audit log</h1>
        <p className="text-ink-500 mt-1 text-sm">
          Security-relevant actions, newest first. Entries are append-only and cannot be edited.
        </p>
      </div>

      {/* A GET form keeps every filter in the URL, so a view can be shared. */}
      <form
        method="GET"
        action="/admin/audit"
        className="border-ink-200 grid gap-3 rounded-xl border bg-white p-3 sm:grid-cols-2 lg:grid-cols-5"
      >
        <div>
          <label htmlFor="audit-action" className="text-ink-600 mb-1 block text-xs font-medium">
            Action
          </label>
          <select
            id="audit-action"
            name="action"
            defaultValue={action ?? ''}
            className="border-ink-300 h-10 w-full rounded-lg border bg-white px-3 text-sm"
          >
            <option value="">All actions</option>
            {facets.actions.map((value) => (
              <option key={value} value={value}>
                {auditActionLabel(value)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="audit-entity" className="text-ink-600 mb-1 block text-xs font-medium">
            Entity type
          </label>
          <select
            id="audit-entity"
            name="entityType"
            defaultValue={entityType ?? ''}
            className="border-ink-300 h-10 w-full rounded-lg border bg-white px-3 text-sm"
          >
            <option value="">All types</option>
            {facets.entityTypes.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="audit-from" className="text-ink-600 mb-1 block text-xs font-medium">
            From
          </label>
          <input
            id="audit-from"
            name="from"
            type="date"
            defaultValue={from ?? ''}
            className="border-ink-300 h-10 w-full rounded-lg border bg-white px-3 text-sm"
          />
        </div>

        <div>
          <label htmlFor="audit-to" className="text-ink-600 mb-1 block text-xs font-medium">
            To
          </label>
          <input
            id="audit-to"
            name="to"
            type="date"
            defaultValue={to ?? ''}
            className="border-ink-300 h-10 w-full rounded-lg border bg-white px-3 text-sm"
          />
        </div>

        <div className="flex items-end gap-2">
          <button
            type="submit"
            className="bg-brand-600 hover:bg-brand-700 h-10 flex-1 rounded-lg px-4 text-sm font-medium text-white"
          >
            Apply
          </button>
          <Link
            href="/admin/audit"
            className="border-ink-300 text-ink-700 hover:bg-ink-50 inline-flex h-10 items-center rounded-lg border bg-white px-3 text-sm"
          >
            Reset
          </Link>
        </div>
      </form>

      <Card className="overflow-hidden">
        {data.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title="No audit entries match these filters"
            description="Logins, publications, role changes and settings updates all appear here."
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[52rem] text-sm">
                <thead>
                  <tr className="border-ink-200 bg-ink-50 border-b text-left">
                    <th
                      scope="col"
                      className="text-ink-500 px-4 py-2.5 text-xs font-semibold tracking-wide uppercase"
                    >
                      When
                    </th>
                    <th
                      scope="col"
                      className="text-ink-500 px-4 py-2.5 text-xs font-semibold tracking-wide uppercase"
                    >
                      Actor
                    </th>
                    <th
                      scope="col"
                      className="text-ink-500 px-4 py-2.5 text-xs font-semibold tracking-wide uppercase"
                    >
                      Action
                    </th>
                    <th
                      scope="col"
                      className="text-ink-500 px-4 py-2.5 text-xs font-semibold tracking-wide uppercase"
                    >
                      Entity
                    </th>
                    <th
                      scope="col"
                      className="text-ink-500 px-4 py-2.5 text-xs font-semibold tracking-wide uppercase"
                    >
                      Details
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-ink-200 divide-y">
                  {data.map((entry) => (
                    <tr key={entry.id} className="hover:bg-ink-50/60 align-top">
                      <td className="text-ink-600 px-4 py-3 whitespace-nowrap">
                        {formatInTimezone(entry.createdAt, timezone)}
                      </td>
                      <td className="px-4 py-3">
                        {entry.actorName ? (
                          <>
                            <span className="text-ink-800 block font-medium">
                              {entry.actorName}
                            </span>
                            <span className="text-ink-500 block text-xs">{entry.actorEmail}</span>
                          </>
                        ) : (
                          <span className="text-ink-500">System / anonymous</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <code className="bg-ink-100 text-ink-700 rounded px-1.5 py-0.5 text-xs">
                          {entry.action}
                        </code>
                      </td>
                      <td className="text-ink-600 px-4 py-3">
                        {entry.entityType}
                        {entry.entityId ? (
                          <span className="text-ink-400"> #{entry.entityId}</span>
                        ) : null}
                      </td>
                      <td className="max-w-md px-4 py-3">
                        {entry.metadata ? (
                          // Rendered as escaped key/value text, never as HTML.
                          <dl className="space-y-0.5 text-xs">
                            {Object.entries(entry.metadata)
                              .slice(0, 6)
                              .map(([key, value]) => (
                                <div key={key} className="flex gap-1.5">
                                  <dt className="text-ink-500 shrink-0 font-medium">{key}:</dt>
                                  <dd className="text-ink-700 min-w-0 truncate">
                                    {typeof value === 'object'
                                      ? JSON.stringify(value)
                                      : String(value)}
                                  </dd>
                                </div>
                              ))}
                          </dl>
                        ) : (
                          <span className="text-ink-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Pagination
              meta={meta}
              itemLabel="entries"
              buildHref={(target) => buildHref({ page: target === 1 ? undefined : String(target) })}
            />
          </>
        )}
      </Card>
    </div>
  );
}
