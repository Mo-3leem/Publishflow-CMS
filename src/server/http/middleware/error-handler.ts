import type { Context, ErrorHandler, NotFoundHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';
import { AppError, isAppError, type ErrorCode } from '@/server/errors/app-error';
import { logger } from '@/server/logger';
import type { AppBindings } from '../types';

/**
 * Central error mapping.
 *
 * Known domain failures become stable API codes. Anything else is logged with
 * its request id and reported as a generic INTERNAL_ERROR — no stack traces, SQL
 * text or driver messages ever reach the client.
 */

interface WireError {
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
    requestId: string;
  };
}

function body(
  code: ErrorCode,
  message: string,
  requestId: string,
  details?: Record<string, unknown>,
): WireError {
  return { error: { code, message, ...(details ? { details } : {}), requestId } };
}

/** Flatten a Zod error into `{ field: [messages] }`. */
export function zodDetails(error: ZodError): Record<string, string[]> {
  const details: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join('.') : '_';
    (details[key] ??= []).push(issue.message);
  }
  return details;
}

/** Recognise the SQLite errors that map to a meaningful client response. */
function mapSqliteError(error: Error & { code?: string }): AppError | null {
  const code = error.code ?? '';
  if (code === 'SQLITE_BUSY' || code === 'SQLITE_BUSY_SNAPSHOT') {
    return new AppError('DATABASE_BUSY', 'The database is busy. Please retry in a moment.');
  }
  if (code.startsWith('SQLITE_CONSTRAINT')) {
    const message = error.message.toLowerCase();
    if (message.includes('users.email')) {
      return new AppError('EMAIL_EXISTS', 'An account with this email address already exists.');
    }
    if (message.includes('.slug')) {
      return new AppError('SLUG_EXISTS', 'That slug is already in use.');
    }
    if (code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
      return new AppError('RESOURCE_IN_USE', 'A related record prevents this change.');
    }
    // CHECK violations mean the payload passed Zod but broke a database
    // invariant — a validation failure, not a server fault.
    return AppError.validation('The request violates a database constraint.');
  }
  return null;
}

export const errorHandler: ErrorHandler<AppBindings> = (error, c) => {
  const requestId = c.get('requestId') ?? 'unknown';

  if (isAppError(error)) {
    return c.json(body(error.code, error.message, requestId, error.details), error.status as 400);
  }

  if (error instanceof ZodError) {
    return c.json(
      body(
        'VALIDATION_ERROR',
        'The request contains invalid fields.',
        requestId,
        zodDetails(error),
      ),
      422,
    );
  }

  if (error instanceof HTTPException) {
    const code: ErrorCode =
      error.status === 401
        ? 'AUTH_REQUIRED'
        : error.status === 403
          ? 'FORBIDDEN'
          : error.status === 404
            ? 'NOT_FOUND'
            : error.status === 413
              ? 'FILE_TOO_LARGE'
              : 'BAD_REQUEST';
    return c.json(body(code, error.message || 'Request failed.', requestId), error.status);
  }

  if (error instanceof Error) {
    const mapped = mapSqliteError(error as Error & { code?: string });
    if (mapped) {
      return c.json(
        body(mapped.code, mapped.message, requestId, mapped.details),
        mapped.status as 400,
      );
    }
  }

  logger.error('unhandled_error', {
    requestId,
    path: c.req.routePath,
    method: c.req.method,
    name: error instanceof Error ? error.name : 'unknown',
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack?.split('\n').slice(0, 5).join(' | ') : undefined,
  });

  return c.json(
    body('INTERNAL_ERROR', 'Something went wrong. The incident has been logged.', requestId),
    500,
  );
};

export const notFoundHandler: NotFoundHandler<AppBindings> = (c: Context<AppBindings>) =>
  c.json(
    body('NOT_FOUND', 'The requested endpoint does not exist.', c.get('requestId') ?? 'unknown'),
    404,
  );
