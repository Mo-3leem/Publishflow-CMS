import { Hono } from 'hono';
import {
  createPostBody,
  deletePostBody,
  listPostsQuery,
  restoreRevisionBody,
  updatePostBody,
  workflowBody,
} from '@/server/contracts/schemas';
import { AppError } from '@/server/errors/app-error';
import {
  createPost,
  deletePost,
  getPostForActor,
  listPosts,
  listWorkflowEvents,
  updatePost,
} from '@/server/services/post-service';
import { getRevision, listRevisions, restoreRevision } from '@/server/services/revision-service';
import { performTransition } from '@/server/services/workflow-service';
import { WORKFLOW_ACTIONS, type WorkflowAction } from '@/lib/workflow';
import { requireAuth } from '../middleware/auth';
import type { AppBindings } from '../types';
import { ctxOf, idParamOf, parseJson, parseQuery, requirePrincipal } from './helpers';

export const postRoutes = new Hono<AppBindings>();

// Every post endpoint requires a session; finer-grained ownership and role rules
// live in the services so a direct API call is checked exactly like a UI action.
postRoutes.use('*', requireAuth());

postRoutes.get('/', (c) => {
  const query = parseQuery(c, listPostsQuery);
  return c.json(listPosts(requirePrincipal(c), query));
});

postRoutes.post('/', async (c) => {
  const body = await parseJson(c, createPostBody);
  return c.json({ data: createPost(ctxOf(c), body) }, 201);
});

postRoutes.get('/:id', (c) => c.json({ data: getPostForActor(requirePrincipal(c), idParamOf(c)) }));

postRoutes.patch('/:id', async (c) => {
  const body = await parseJson(c, updatePostBody);
  return c.json({ data: updatePost(ctxOf(c), idParamOf(c), body) });
});

postRoutes.delete('/:id', async (c) => {
  const body = await parseJson(c, deletePostBody);
  deletePost(ctxOf(c), idParamOf(c), body.expectedVersion);
  return c.body(null, 204);
});

postRoutes.get('/:id/workflow-events', (c) =>
  c.json({ data: listWorkflowEvents(requirePrincipal(c), idParamOf(c)) }),
);

/* -------------------------------- revisions ------------------------------- */
// Registered before the workflow catch-all below; they have more path segments
// so they cannot collide, but keeping them first documents the intent.

postRoutes.get('/:id/revisions', (c) =>
  c.json({ data: listRevisions(requirePrincipal(c), idParamOf(c)) }),
);

postRoutes.get('/:id/revisions/:revisionId', (c) =>
  c.json({
    data: getRevision(requirePrincipal(c), idParamOf(c), idParamOf(c, 'revisionId')),
  }),
);

postRoutes.post('/:id/revisions/:revisionId/restore', async (c) => {
  const body = await parseJson(c, restoreRevisionBody);
  const post = restoreRevision(ctxOf(c), idParamOf(c), idParamOf(c, 'revisionId'), {
    expectedVersion: body.expectedVersion,
    changeSummary: body.changeSummary ?? null,
  });
  return c.json({ data: post });
});

/* ------------------------------ workflow actions -------------------------- */

/**
 * One handler for all seven transitions: the action name is validated against
 * the allow-list, and the state machine in `@/lib/workflow` decides the rest.
 */
postRoutes.post('/:id/:action', async (c) => {
  const action = c.req.param('action');
  if (!(WORKFLOW_ACTIONS as readonly string[]).includes(action)) {
    throw AppError.notFound('Action');
  }

  const body = await parseJson(c, workflowBody);
  const post = performTransition(ctxOf(c), idParamOf(c), action as WorkflowAction, {
    expectedVersion: body.expectedVersion,
    comment: body.comment ?? null,
    scheduledAt: body.scheduledAt ?? null,
  });

  return c.json({ data: post });
});
