/**
 * Typed application errors.
 *
 * Services throw these; a single Hono error handler maps them to the wire format
 * described in the specification. Nothing else may reach the client — unexpected
 * exceptions are logged server-side and reported as INTERNAL_ERROR.
 */

export const ERROR_CODES = {
  VALIDATION_ERROR: 422,
  AUTH_INVALID_CREDENTIALS: 401,
  AUTH_REQUIRED: 401,
  SESSION_EXPIRED: 401,
  CSRF_FAILED: 403,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  EMAIL_EXISTS: 409,
  SLUG_EXISTS: 409,
  VERSION_CONFLICT: 409,
  INVALID_STATE_TRANSITION: 409,
  RESOURCE_IN_USE: 409,
  LAST_ACTIVE_ADMIN: 409,
  INVALID_MENU_TREE: 409,
  UNSUPPORTED_MEDIA_TYPE: 415,
  FILE_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  DATABASE_BUSY: 503,
  INTERNAL_ERROR: 500,
  BAD_REQUEST: 400,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export type ErrorDetails = Record<string, unknown>;

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: ErrorDetails;

  constructor(code: ErrorCode, message: string, details?: ErrorDetails) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = ERROR_CODES[code];
    this.details = details;
  }

  static validation(message: string, details?: ErrorDetails): AppError {
    return new AppError('VALIDATION_ERROR', message, details);
  }

  static notFound(resource = 'Resource'): AppError {
    return new AppError('NOT_FOUND', `${resource} was not found.`);
  }

  static forbidden(message = 'You do not have permission to perform this action.'): AppError {
    return new AppError('FORBIDDEN', message);
  }

  static authRequired(message = 'Authentication is required.'): AppError {
    return new AppError('AUTH_REQUIRED', message);
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

/** Message shown for every failed login regardless of the real cause. */
export const GENERIC_LOGIN_FAILURE = 'Invalid email or password.';
