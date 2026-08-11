import type { MiddlewareHandler } from 'hono';
import { getEnv } from '@/server/env';
import { AppError } from '@/server/errors/app-error';
import type { AppBindings } from '../types';

/**
 * Bounded in-process rate limiter.
 *
 * Adequate for the single-instance SQLite deployment this project targets. It
 * would need to move to a shared store (Redis, or a database table like the one
 * used for login throttling) before running multiple replicas — documented as a
 * trade-off rather than pretended away.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const MAX_TRACKED_KEYS = 5_000;
const buckets = new Map<string, Bucket>();

function prune(now: number): void {
  if (buckets.size < MAX_TRACKED_KEYS) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  // Still full of live buckets: drop the oldest to keep memory bounded.
  if (buckets.size >= MAX_TRACKED_KEYS) {
    const excess = buckets.size - Math.floor(MAX_TRACKED_KEYS * 0.8);
    let removed = 0;
    for (const key of buckets.keys()) {
      buckets.delete(key);
      if (++removed >= excess) break;
    }
  }
}

/**
 * Best-effort client identity.
 *
 * Proxy headers are only trusted when TRUST_PROXY is on, because otherwise any
 * caller could spoof `X-Forwarded-For` and reset their own limit.
 */
export function clientKey(c: { req: { header: (name: string) => string | undefined } }): string {
  if (getEnv().TRUST_PROXY) {
    const forwarded = c.req.header('x-forwarded-for');
    const first = forwarded?.split(',')[0]?.trim();
    if (first) return first;
    const real = c.req.header('x-real-ip');
    if (real) return real;
  }
  // Without a trusted proxy header there is no reliable address at this layer;
  // fall back to a coarse fingerprint so the limiter still segments callers.
  return `ua:${(c.req.header('user-agent') ?? 'unknown').slice(0, 80)}`;
}

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  /** Distinguishes independent limits sharing one process. */
  scope: string;
}

export const rateLimit =
  (options: RateLimitOptions): MiddlewareHandler<AppBindings> =>
  async (c, next) => {
    const now = Date.now();
    prune(now);

    const key = `${options.scope}:${clientKey(c)}`;
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      await next();
      return;
    }

    bucket.count += 1;

    if (bucket.count > options.max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      c.header('Retry-After', String(retryAfter));
      throw new AppError('RATE_LIMITED', `Too many requests. Retry in ${retryAfter} seconds.`);
    }

    await next();
  };

/** Test helper: forget every bucket. */
export function resetRateLimits(): void {
  buckets.clear();
}
