'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Save } from 'lucide-react';
import type { SiteSettingsDto } from '@/server/services/settings-service';
import { api, ApiError } from '@/client/api-client';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/field';
import { Card, CardHeader, Alert } from '@/components/ui/surfaces';
import { MediaPicker } from './media-picker';
import { formatInTimezone } from '@/lib/datetime';

/**
 * Site settings (Admin only).
 *
 * `updatedBy` and `updatedAt` are set by the server on every write and are never
 * read from this payload.
 */

const COMMON_TIMEZONES = [
  'UTC',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Madrid',
  'Africa/Cairo',
  'Africa/Lagos',
  'Asia/Dubai',
  'Asia/Karachi',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
];

export function SettingsForm({ settings }: { settings: SiteSettingsDto }) {
  const router = useRouter();
  const [form, setForm] = React.useState({
    siteName: settings.siteName,
    siteDescription: settings.siteDescription,
    logoMediaId: settings.logoMediaId,
    defaultSeoTitle: settings.defaultSeoTitle ?? '',
    defaultSeoDescription: settings.defaultSeoDescription ?? '',
    postsPerPage: settings.postsPerPage,
    timezone: settings.timezone,
  });
  const [saving, setSaving] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});
  const [formError, setFormError] = React.useState<string | null>(null);

  const update = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((previous) => ({ ...previous, [key]: value }));

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setErrors({});
    setFormError(null);

    try {
      await api.patch<SiteSettingsDto>('/settings', {
        siteName: form.siteName.trim(),
        siteDescription: form.siteDescription.trim(),
        logoMediaId: form.logoMediaId,
        defaultSeoTitle: form.defaultSeoTitle.trim() || null,
        defaultSeoDescription: form.defaultSeoDescription.trim() || null,
        postsPerPage: Number(form.postsPerPage),
        timezone: form.timezone,
      });
      toast.success('Settings saved. The public site reflects the change immediately.');
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError) {
        const fields = error.fieldErrors();
        setErrors(Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, [v]])));
        setFormError(Object.keys(fields).length > 0 ? null : error.message);
      } else {
        setFormError('Could not save the settings.');
      }
    } finally {
      setSaving(false);
    }
  };

  const timezoneOptions = COMMON_TIMEZONES.includes(settings.timezone)
    ? COMMON_TIMEZONES
    : [settings.timezone, ...COMMON_TIMEZONES];

  return (
    <form onSubmit={save} className="space-y-5">
      {formError ? <Alert tone="error">{formError}</Alert> : null}

      <Card>
        <CardHeader
          title="Site identity"
          description="Shown in the header, footer and page titles."
        />
        <div className="space-y-4 p-5">
          <Field label="Site name" htmlFor="siteName" required error={errors.siteName}>
            <Input
              id="siteName"
              value={form.siteName}
              onChange={(event) => update('siteName', event.target.value)}
              maxLength={120}
              invalid={Boolean(errors.siteName)}
            />
          </Field>

          <Field
            label="Tagline"
            htmlFor="siteDescription"
            error={errors.siteDescription}
            counter={`${form.siteDescription.length} / 300`}
          >
            <Textarea
              id="siteDescription"
              value={form.siteDescription}
              onChange={(event) => update('siteDescription', event.target.value)}
              maxLength={300}
              rows={2}
            />
          </Field>

          <MediaPicker
            label="Site logo"
            emptyLabel="No logo set"
            value={form.logoMediaId}
            onChange={(value) => update('logoMediaId', value)}
          />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Default SEO"
          description="Used on pages that do not set their own title or description."
        />
        <div className="space-y-4 p-5">
          <Field
            label="Default SEO title"
            htmlFor="defaultSeoTitle"
            error={errors.defaultSeoTitle}
            hint="Around 60 characters reads best in search results."
            counter={`${form.defaultSeoTitle.length} / 120`}
          >
            <Input
              id="defaultSeoTitle"
              value={form.defaultSeoTitle}
              onChange={(event) => update('defaultSeoTitle', event.target.value)}
              maxLength={120}
            />
          </Field>

          <Field
            label="Default SEO description"
            htmlFor="defaultSeoDescription"
            error={errors.defaultSeoDescription}
            hint="Around 160 characters reads best in search results."
            counter={`${form.defaultSeoDescription.length} / 300`}
          >
            <Textarea
              id="defaultSeoDescription"
              value={form.defaultSeoDescription}
              onChange={(event) => update('defaultSeoDescription', event.target.value)}
              maxLength={300}
              rows={3}
            />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="Display" />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field
            label="Posts per page"
            htmlFor="postsPerPage"
            required
            error={errors.postsPerPage}
            hint="Between 1 and 100. Applies to the public listings."
          >
            <Input
              id="postsPerPage"
              type="number"
              min={1}
              max={100}
              value={form.postsPerPage}
              onChange={(event) => update('postsPerPage', Number(event.target.value))}
              invalid={Boolean(errors.postsPerPage)}
            />
          </Field>

          <Field
            label="Display timezone"
            htmlFor="timezone"
            required
            error={errors.timezone}
            hint="Timestamps are stored in UTC and rendered in this timezone."
          >
            <select
              id="timezone"
              value={form.timezone}
              onChange={(event) => update('timezone', event.target.value)}
              className="border-ink-300 hover:border-ink-400 focus:border-brand-500 h-10 w-full rounded-lg border bg-white px-3 text-sm shadow-sm"
            >
              {timezoneOptions.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Card>

      <div className="border-ink-200 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white px-5 py-4">
        <p className="text-ink-500 text-sm">
          Last updated {formatInTimezone(settings.updatedAt, settings.timezone)}
          {settings.updatedByName ? ` by ${settings.updatedByName}` : ''}.
        </p>
        <Button type="submit" loading={saving}>
          {!saving ? <Save aria-hidden="true" className="h-4 w-4" /> : null}
          Save settings
        </Button>
      </div>
    </form>
  );
}
