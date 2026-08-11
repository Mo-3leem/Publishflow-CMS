import 'server-only';
import type { Principal } from '@/lib/domain';

/**
 * Everything a service needs to know about the caller.
 *
 * Passing this explicitly (rather than reading a request-scoped global) keeps
 * services callable from route handlers, Server Components, tests and cron jobs
 * alike.
 */
export interface ActorContext {
  actor: Principal;
  requestId: string;
}

/** Synthetic actor for the scheduled-publishing job. */
export const SYSTEM_ACTOR_NAME = 'System (scheduler)';
export const SYSTEM_ACTOR_EMAIL = 'system@publishflow.local';
