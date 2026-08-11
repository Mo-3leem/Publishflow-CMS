'use client';

import type { ErrorCode } from '@/server/errors/app-error';

/**
 * Typed fetch wrapper for the Hono API.
 *
 * Responsibilities kept deliberately narrow: envelope unwrapping, CSRF header
 * injection and error normalisation. No business rules live here — the server is
 * authoritative, and duplicating a rule in the client only creates drift.
 */

const BASE = '/api/v1';

export class ApiError extends Error {
  readonly code: ErrorCode | string;
  readonly status: number;
  readonly details?: Record<string, unknown>;
  readonly requestId?: string;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
    requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }

  /** Field-level messages for react-hook-form, when the server sent any. */
  fieldErrors(): Record<string, string> {
    const output: Record<string, string> = {};
    if (!this.details) return output;
    for (const [key, value] of Object.entries(this.details)) {
      if (Array.isArray(value) && typeof value[0] === 'string') output[key] = value[0];
      else if (typeof value === 'string') output[key] = value;
    }
    return output;
  }
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function csrfToken(): string | null {
  return readCookie('pf_csrf') ?? readCookie('__Host-pf_csrf');
}

/** Ask the server for a fresh CSRF token; used to recover from a 403 once. */
export async function refreshCsrf(): Promise<void> {
  await fetch(`${BASE}/auth/csrf`, { credentials: 'same-origin' }).catch(() => undefined);
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  /** Set for multipart uploads, where the browser must own the Content-Type. */
  formData?: FormData;
}

async function raw(path: string, options: RequestOptions = {}, retried = false): Promise<Response> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = {};

  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  // Only unsafe methods need the CSRF header; GET is never state-changing here.
  if (method !== 'GET') {
    const token = csrfToken();
    if (token) headers['X-CSRF-Token'] = token;
  }

  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    credentials: 'same-origin',
    signal: options.signal,
    body:
      options.formData ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
  });

  // A stale CSRF cookie (e.g. after a session rotation) is recoverable: fetch a
  // fresh token and replay the request exactly once.
  if (response.status === 403 && !retried) {
    const clone = response.clone();
    const payload = (await clone.json().catch(() => null)) as { error?: { code?: string } } | null;
    if (payload?.error?.code === 'CSRF_FAILED') {
      await refreshCsrf();
      return raw(path, options, true);
    }
  }

  return response;
}

async function toError(response: Response): Promise<ApiError> {
  const payload = (await response.json().catch(() => null)) as {
    error?: {
      code?: string;
      message?: string;
      details?: Record<string, unknown>;
      requestId?: string;
    };
  } | null;

  return new ApiError(
    response.status,
    payload?.error?.code ?? 'INTERNAL_ERROR',
    payload?.error?.message ?? 'The request failed. Please try again.',
    payload?.error?.details,
    payload?.error?.requestId,
  );
}

/** Unwraps `{ data }` and throws `ApiError` on any non-2xx response. */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await raw(path, options);

  if (!response.ok) throw await toError(response);
  if (response.status === 204) return undefined as T;

  const payload = (await response.json()) as { data: T };
  return payload.data;
}

/** Same as `apiRequest` but keeps the `meta` block from a list response. */
export async function apiList<T>(
  path: string,
  options: RequestOptions = {},
): Promise<{
  data: T[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}> {
  const response = await raw(path, options);
  if (!response.ok) throw await toError(response);
  return (await response.json()) as {
    data: T[];
    meta: { page: number; pageSize: number; total: number; totalPages: number };
  };
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => apiRequest<T>(path, { method: 'GET', signal }),
  list: <T>(path: string, signal?: AbortSignal) => apiList<T>(path, { method: 'GET', signal }),
  post: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PUT', body }),
  delete: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'DELETE', body }),
  upload: <T>(path: string, formData: FormData) =>
    apiRequest<T>(path, { method: 'POST', formData }),
};

/** Build a query string, skipping empty values. */
export function queryString(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const output = search.toString();
  return output ? `?${output}` : '';
}
