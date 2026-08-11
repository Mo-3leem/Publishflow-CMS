import type { MiddlewareHandler } from 'hono';
import { getEnv } from '@/server/env';
import { AppError } from '@/server/errors/app-error';
import type { AppBindings } from '../types';

/**
 * Request body size cap.
 *
 * Checks `Content-Length` before the body is read so an oversized payload is
 * rejected without buffering it. Chunked requests without a length header are
 * bounded by the per-route reader instead (see the media upload route).
 */
export const jsonBodyLimit = (): MiddlewareHandler<AppBindings> => async (c, next) => {
  const method = c.req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    await next();
    return;
  }

  const contentType = c.req.header('content-type') ?? '';
  // Multipart uploads have their own, larger limit.
  if (contentType.includes('multipart/form-data')) {
    await next();
    return;
  }

  const declared = Number(c.req.header('content-length') ?? '0');
  const limit = getEnv().MAX_JSON_BYTES;

  if (Number.isFinite(declared) && declared > limit) {
    throw new AppError(
      'FILE_TOO_LARGE',
      `The request body exceeds the ${Math.floor(limit / 1024)} KB limit.`,
    );
  }

  await next();
};
