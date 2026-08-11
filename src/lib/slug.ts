import slugify from 'slugify';

/** Slug rules shared by categories and posts. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Normalise arbitrary text into a URL-safe slug.
 * Returns an empty string when nothing usable remains — callers decide whether
 * that is a validation error or a cue to fall back to a generated value.
 */
export function normalizeSlug(input: string): string {
  const slug = slugify(input, {
    lower: true,
    strict: true,
    trim: true,
    locale: 'en',
  });
  return slug.replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-');
}

export function isValidSlug(value: string): boolean {
  return SLUG_PATTERN.test(value);
}

/**
 * Produce a slug that does not collide with existing values.
 * Appends `-2`, `-3`, ... deterministically so repeated seeds are stable.
 */
export function uniqueSlug(
  desired: string,
  exists: (candidate: string) => boolean,
  maxLength = 220,
): string {
  const base = normalizeSlug(desired).slice(0, maxLength) || 'item';
  if (!exists(base)) return base;

  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const tail = `-${suffix}`;
    const candidate = `${base.slice(0, maxLength - tail.length)}${tail}`;
    if (!exists(candidate)) return candidate;
  }
  throw new Error(`Could not derive a unique slug from "${desired}".`);
}
