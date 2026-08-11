/**
 * Time handling.
 *
 * The database stores UTC ISO 8601 strings written by the application. SQL
 * defaults (`CURRENT_TIMESTAMP`) exist only as a safety net, so every write path
 * goes through `nowIso()` to keep one canonical format.
 */

export function nowIso(): string {
  return new Date().toISOString();
}

export function toIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const date = typeof value === 'string' ? parseStoredDate(value) : value;
  if (!date || Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

/**
 * Parse a timestamp read from SQLite.
 *
 * Accepts both the canonical ISO strings the application writes and the
 * `YYYY-MM-DD HH:MM:SS` form produced by SQL `CURRENT_TIMESTAMP`, which is UTC
 * but carries no zone designator.
 */
export function parseStoredDate(value: string): Date | null {
  if (!value) return null;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** UTC calendar day (`YYYY-MM-DD`) used as the read de-duplication bucket. */
export function utcDateKey(at: Date = new Date()): string {
  return at.toISOString().slice(0, 10);
}

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** Render a stored UTC timestamp in the site-configured timezone. */
export function formatInTimezone(
  value: string | null | undefined,
  timezone: string,
  options: Intl.DateTimeFormatOptions = {
    dateStyle: 'medium',
    timeStyle: 'short',
  },
): string {
  if (!value) return '—';
  const date = parseStoredDate(value);
  if (!date) return '—';
  try {
    return new Intl.DateTimeFormat('en-GB', { ...options, timeZone: timezone }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' }).format(date);
  }
}

export function formatDateOnly(value: string | null | undefined, timezone: string): string {
  return formatInTimezone(value, timezone, { dateStyle: 'medium' });
}

/** Value for a `datetime-local` input, expressed in the given timezone. */
export function toDateTimeLocalValue(value: string | null | undefined, timezone: string): string {
  if (!value) return '';
  const date = parseStoredDate(value);
  if (!date) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}`;
}

/** Offset in minutes between UTC and `timezone` at the given instant. */
function timezoneOffsetMinutes(timezone: string, at: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = dtf.formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') === 24 ? 0 : get('hour'),
    get('minute'),
    get('second'),
  );
  return (asUtc - at.getTime()) / 60_000;
}

/** Interpret a `datetime-local` value as wall-clock time in `timezone` → UTC ISO. */
export function fromDateTimeLocalValue(value: string, timezone: string): string | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match;
  const naiveUtc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi));
  // Two passes settle DST boundaries where the first guess lands on the wrong side.
  let instant = naiveUtc - timezoneOffsetMinutes(timezone, new Date(naiveUtc)) * 60_000;
  instant = naiveUtc - timezoneOffsetMinutes(timezone, new Date(instant)) * 60_000;
  const date = new Date(instant);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function relativeTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = parseStoredDate(value);
  if (!date) return '—';
  const diffSeconds = Math.round((date.getTime() - Date.now()) / 1000);
  const abs = Math.abs(diffSeconds);
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

  if (abs < 60) return formatter.format(Math.round(diffSeconds), 'second');
  if (abs < 3600) return formatter.format(Math.round(diffSeconds / 60), 'minute');
  if (abs < 86_400) return formatter.format(Math.round(diffSeconds / 3600), 'hour');
  if (abs < 2_592_000) return formatter.format(Math.round(diffSeconds / 86_400), 'day');
  if (abs < 31_536_000) return formatter.format(Math.round(diffSeconds / 2_592_000), 'month');
  return formatter.format(Math.round(diffSeconds / 31_536_000), 'year');
}
