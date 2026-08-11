import type { Principal } from '@/lib/domain';
import type { ActorContext } from '@/server/services/context';

/** Variables attached to the Hono context by middleware. */
export interface AppVariables {
  requestId: string;
  principal?: Principal;
  sessionId?: number;
  sessionTokenHash?: string;
  csrfNonce?: string;
}

export interface AppBindings {
  Variables: AppVariables;
}

/** Build the service-layer actor context from an authenticated request. */
export function actorContextOf(principal: Principal, requestId: string): ActorContext {
  return { actor: principal, requestId };
}
