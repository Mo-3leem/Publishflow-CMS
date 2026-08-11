import type { Context } from 'hono';
import type { z } from 'zod';
import { AppError } from '@/server/errors/app-error';
import { zodDetails } from '../middleware/error-handler';
import type { AppBindings, AppVariables } from '../types';
import type { Principal } from '@/lib/domain';
import { actorContextOf } from '../types';
import type { ActorContext } from '@/server/services/context';

/**
 * Route helpers.
 *
 * Route handlers stay thin: parse, delegate to a service, shape the envelope.
 * No business rule lives here.
 */

export async function parseJson<T extends z.ZodTypeAny>(
  c: Context<AppBindings>,
  schema: T,
): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new AppError('BAD_REQUEST', 'The request body must be valid JSON.');
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw AppError.validation('The request contains invalid fields.', zodDetails(parsed.error));
  }
  return parsed.data;
}

export function parseQuery<T extends z.ZodTypeAny>(c: Context<AppBindings>, schema: T): z.infer<T> {
  const parsed = schema.safeParse(c.req.query());
  if (!parsed.success) {
    throw AppError.validation(
      'The query string contains invalid values.',
      zodDetails(parsed.error),
    );
  }
  return parsed.data;
}

/** Path parameter that must be a positive integer id. */
export function idParamOf(c: Context<AppBindings>, name = 'id'): number {
  const raw = c.req.param(name);
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw AppError.notFound();
  }
  return value;
}

export function requirePrincipal(c: Context<AppBindings>): Principal {
  const principal = c.get('principal' as keyof AppVariables) as Principal | undefined;
  if (!principal) throw AppError.authRequired();
  return principal;
}

export function ctxOf(c: Context<AppBindings>): ActorContext {
  return actorContextOf(requirePrincipal(c), c.get('requestId'));
}
