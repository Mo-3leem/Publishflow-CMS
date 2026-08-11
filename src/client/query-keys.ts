/**
 * TanStack Query cache keys.
 *
 * Centralised so an invalidation after a mutation cannot silently miss a list
 * because two call sites spelled the key differently.
 */
export const queryKeys = {
  auth: {
    me: ['auth', 'me'] as const,
  },
  dashboard: {
    all: ['dashboard'] as const,
  },
  posts: {
    all: ['posts'] as const,
    list: (query: string) => ['posts', 'list', query] as const,
    detail: (id: number) => ['posts', 'detail', id] as const,
    revisions: (id: number) => ['posts', 'revisions', id] as const,
    revision: (id: number, revisionId: number) => ['posts', 'revisions', id, revisionId] as const,
    workflow: (id: number) => ['posts', 'workflow-events', id] as const,
  },
  categories: {
    all: ['categories'] as const,
  },
  users: {
    all: ['users'] as const,
    list: (query: string) => ['users', 'list', query] as const,
  },
  menus: {
    all: ['menus'] as const,
    detail: (id: number) => ['menus', id] as const,
  },
  media: {
    all: ['media'] as const,
    list: (query: string) => ['media', 'list', query] as const,
  },
  settings: {
    all: ['settings'] as const,
  },
  audit: {
    list: (query: string) => ['audit', 'list', query] as const,
    facets: ['audit', 'facets'] as const,
  },
} as const;
