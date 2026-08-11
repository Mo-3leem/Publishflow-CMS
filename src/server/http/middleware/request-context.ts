import type { MiddlewareHandler } from 'hono';
import crypto from 'node:crypto';
import { logger } from '@/server/logger';
import type { AppBindings } from '../types';

/**
 * Request id + structured access log.
 *
 * An inbound `X-Request-Id` is honoured when it looks safe, so a reverse proxy
 * can correlate logs; anything else is replaced with a generated value rather
 * than echoed back (an attacker-controlled id would poison the log).
 */

const SAFE_REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

export function generateRequestId(): string {
  return `req_${crypto.randomBytes(12).toString('base64url')}`;
}

export const requestContext = (): MiddlewareHandler<AppBindings> => async (c, next) => {
  const inbound = c.req.header('x-request-id');
  const requestId = inbound && SAFE_REQUEST_ID.test(inbound) ? inbound : generateRequestId();

  c.set('requestId', requestId);
  c.header('X-Request-Id', requestId);

  const startedAt = Date.now();
  await next();

  logger.info('http_request', {
    requestId,
    method: c.req.method,
    // `routePath` is the template (/posts/:id), not the concrete URL, so ids and
    // query strings never reach the log.
    path: c.req.routePath,
    status: c.res.status,
    latencyMs: Date.now() - startedAt,
    userId: c.get('principal')?.id,
  });
};
