/**
 * URL scheme validation.
 *
 * Menu items and post source links are rendered as anchors, so `javascript:`,
 * `data:`, `vbscript:` and friends must never survive validation.
 */

const SAFE_EXTERNAL_SCHEMES = new Set(['http:', 'https:']);

const MAX_URL_LENGTH = 2048;

/**
 * Browsers strip ASCII control characters and whitespace before parsing a URL,
 * so `java\nscript:alert(1)` would slip past a naive scheme check. Reject any
 * string containing them rather than trying to replicate that normalisation.
 */
function hasControlOrSpace(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** Absolute http(s) URL, e.g. a post source. */
export function isSafeExternalUrl(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_URL_LENGTH) return false;
  if (hasControlOrSpace(trimmed)) return false;
  try {
    const url = new URL(trimmed);
    return SAFE_EXTERNAL_SCHEMES.has(url.protocol);
  } catch {
    return false;
  }
}

/** Same-origin path such as `/about` or `/posts/hello?x=1#top`. */
export function isSafeInternalPath(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_URL_LENGTH) return false;
  if (!trimmed.startsWith('/')) return false;
  // `//evil.com` is protocol-relative and leaves the site.
  if (trimmed.startsWith('//')) return false;
  // Backslashes are normalised to `/` by some browsers, so `/\evil.com` escapes too.
  if (trimmed.includes('\\')) return false;
  if (hasControlOrSpace(trimmed)) return false;
  return true;
}

/** Accepted for a CUSTOM menu item: absolute http(s) or a safe internal path. */
export function isSafeLinkTarget(value: string): boolean {
  return isSafeExternalUrl(value) || isSafeInternalPath(value);
}
