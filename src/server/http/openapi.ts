import { z } from 'zod';
import {
  auditLogSchema,
  categorySchema,
  changePasswordBody,
  createCategoryBody,
  createMenuItemBody,
  createPostBody,
  createUserBody,
  deletePostBody,
  loginBody,
  resetPasswordBody,
  updateMediaBody,
  updateMenuItemBody,
  mediaSchema,
  menuSchema,
  postDetailSchema,
  postSummarySchema,
  publicCategorySchema,
  publicPostDetailSchema,
  publicPostSummarySchema,
  publicSettingsSchema,
  reorderMenuBody,
  restoreRevisionBody,
  revisionDetailSchema,
  revisionSummarySchema,
  settingsSchema,
  updateCategoryBody,
  updatePostBody,
  updateSettingsBody,
  updateUserBody,
  viewResultSchema,
  workflowBody,
} from '@/server/contracts/schemas';
import { errorSchema, paginationMetaSchema, safeUserSchema } from '@/server/contracts/common';
import { getEnv } from '@/server/env';

/**
 * OpenAPI 3.1 document generated from the same Zod schemas the server validates
 * with, so the published contract cannot drift from the implementation.
 */

type JsonObject = Record<string, unknown>;

const registry: Array<[string, z.ZodTypeAny]> = [
  ['User', safeUserSchema],
  ['Category', categorySchema],
  ['PostSummary', postSummarySchema],
  ['Post', postDetailSchema],
  ['RevisionSummary', revisionSummarySchema],
  ['Revision', revisionDetailSchema],
  ['Menu', menuSchema],
  ['MediaAsset', mediaSchema],
  ['SiteSettings', settingsSchema],
  ['PublicSiteSettings', publicSettingsSchema],
  ['PublicPostSummary', publicPostSummarySchema],
  ['PublicPost', publicPostDetailSchema],
  ['PublicCategory', publicCategorySchema],
  ['AuditLogEntry', auditLogSchema],
  ['ViewResult', viewResultSchema],
  ['PaginationMeta', paginationMetaSchema],
  ['ErrorResponse', errorSchema],
  ['LoginRequest', loginBody],
  ['CreateUserRequest', createUserBody],
  ['UpdateUserRequest', updateUserBody],
  ['CreateCategoryRequest', createCategoryBody],
  ['UpdateCategoryRequest', updateCategoryBody],
  ['CreatePostRequest', createPostBody],
  ['UpdatePostRequest', updatePostBody],
  ['WorkflowActionRequest', workflowBody],
  ['RestoreRevisionRequest', restoreRevisionBody],
  ['CreateMenuItemRequest', createMenuItemBody],
  ['UpdateMenuItemRequest', updateMenuItemBody],
  ['ReorderMenuRequest', reorderMenuBody],
  ['UpdateSettingsRequest', updateSettingsBody],
  ['ChangePasswordRequest', changePasswordBody],
  ['ResetPasswordRequest', resetPasswordBody],
  ['UpdateMediaRequest', updateMediaBody],
  ['DeletePostRequest', deletePostBody],
];

function buildSchemas(): JsonObject {
  const schemas: JsonObject = {};
  for (const [name, schema] of registry) {
    schemas[name] = z.toJSONSchema(schema, { io: 'output', unrepresentable: 'any' }) as JsonObject;
  }
  return schemas;
}

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

const jsonBody = (name: string) => ({
  required: true,
  content: { 'application/json': { schema: ref(name) } },
});

const jsonResponse = (description: string, schema: JsonObject) => ({
  description,
  content: { 'application/json': { schema } },
});

const listResponse = (itemName: string) =>
  jsonResponse('Paginated list', {
    type: 'object',
    properties: { data: { type: 'array', items: ref(itemName) }, meta: ref('PaginationMeta') },
    required: ['data', 'meta'],
  });

const itemResponse = (name: string, description = 'Single resource') =>
  jsonResponse(description, {
    type: 'object',
    properties: { data: ref(name) },
    required: ['data'],
  });

const errorResponses = {
  '401': jsonResponse('Authentication required', ref('ErrorResponse')),
  '403': jsonResponse('Forbidden', ref('ErrorResponse')),
  '404': jsonResponse('Not found', ref('ErrorResponse')),
  '409': jsonResponse(
    'Conflict (version, slug, state transition or resource in use)',
    ref('ErrorResponse'),
  ),
  '422': jsonResponse('Validation failed', ref('ErrorResponse')),
} as const;

const pageParams = [
  { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 }, required: false },
  {
    name: 'pageSize',
    in: 'query',
    schema: { type: 'integer', minimum: 1, maximum: 100 },
    required: false,
  },
];

const idPath = (name = 'id') => ({
  name,
  in: 'path',
  required: true,
  schema: { type: 'integer', minimum: 1 },
});

const cookieAuth = [{ cookieAuth: [] }];

function buildPaths(): JsonObject {
  return {
    '/health': {
      get: {
        tags: ['System'],
        summary: 'Process and database health',
        security: [],
        responses: { '200': jsonResponse('Healthy', { type: 'object' }) },
      },
    },
    '/auth/login': {
      post: {
        tags: ['Authentication'],
        summary: 'Create a session',
        security: [],
        requestBody: jsonBody('LoginRequest'),
        responses: {
          '200': jsonResponse('Signed in; sets the session and CSRF cookies', {
            type: 'object',
            properties: {
              data: {
                type: 'object',
                properties: { user: ref('User'), csrfToken: { type: 'string' } },
              },
            },
          }),
          '401': jsonResponse('Invalid credentials (generic)', ref('ErrorResponse')),
          '429': jsonResponse('Too many failed attempts', ref('ErrorResponse')),
        },
      },
    },
    '/auth/logout': {
      post: {
        tags: ['Authentication'],
        summary: 'Revoke the current session',
        security: cookieAuth,
        responses: { '204': { description: 'Signed out' }, ...errorResponses },
      },
    },
    '/auth/me': {
      get: {
        tags: ['Authentication'],
        summary: 'Current user',
        security: cookieAuth,
        responses: { '200': itemResponse('User', 'Current principal'), ...errorResponses },
      },
    },
    '/auth/csrf': {
      get: {
        tags: ['Authentication'],
        summary: 'Issue a session-bound CSRF token',
        description:
          'Returns the token and sets the readable `pf_csrf` cookie. Send the same value in `X-CSRF-Token` on every unsafe request.',
        security: cookieAuth,
        responses: {
          '200': jsonResponse('Token issued', {
            type: 'object',
            properties: {
              data: { type: 'object', properties: { csrfToken: { type: 'string' } } },
            },
          }),
          ...errorResponses,
        },
      },
    },
    '/auth/change-password': {
      post: {
        tags: ['Authentication'],
        summary: 'Change own password and revoke other sessions',
        security: cookieAuth,
        requestBody: jsonBody('ChangePasswordRequest'),
        responses: {
          '200': jsonResponse('Password changed', { type: 'object' }),
          ...errorResponses,
        },
      },
    },
    '/users': {
      get: {
        tags: ['Users'],
        summary: 'List users (Admin)',
        security: cookieAuth,
        parameters: [
          ...pageParams,
          { name: 'q', in: 'query', schema: { type: 'string' }, required: false },
          {
            name: 'role',
            in: 'query',
            schema: { type: 'string', enum: ['ADMIN', 'EDITOR', 'AUTHOR'] },
            required: false,
          },
          {
            name: 'status',
            in: 'query',
            schema: { type: 'string', enum: ['ACTIVE', 'DISABLED'] },
            required: false,
          },
        ],
        responses: { '200': listResponse('User'), ...errorResponses },
      },
      post: {
        tags: ['Users'],
        summary: 'Create a user (Admin)',
        security: cookieAuth,
        requestBody: jsonBody('CreateUserRequest'),
        responses: { '201': itemResponse('User', 'Created'), ...errorResponses },
      },
    },
    '/users/{id}': {
      get: {
        tags: ['Users'],
        summary: 'Get a user (Admin)',
        security: cookieAuth,
        parameters: [idPath()],
        responses: { '200': itemResponse('User'), ...errorResponses },
      },
      patch: {
        tags: ['Users'],
        summary: 'Update name, role or status (Admin)',
        description:
          'Rejects with `LAST_ACTIVE_ADMIN` when the change would leave no active administrator.',
        security: cookieAuth,
        parameters: [idPath()],
        requestBody: jsonBody('UpdateUserRequest'),
        responses: { '200': itemResponse('User'), ...errorResponses },
      },
    },
    '/users/{id}/reset-password': {
      post: {
        tags: ['Users'],
        summary: 'Set a new password and revoke that user’s sessions (Admin)',
        security: cookieAuth,
        parameters: [idPath()],
        requestBody: jsonBody('ResetPasswordRequest'),
        responses: { '200': itemResponse('User'), ...errorResponses },
      },
    },
    '/categories': {
      get: {
        tags: ['Categories'],
        summary: 'List categories (staff)',
        security: cookieAuth,
        responses: { '200': listResponse('Category'), ...errorResponses },
      },
      post: {
        tags: ['Categories'],
        summary: 'Create a category (Admin/Editor)',
        security: cookieAuth,
        requestBody: jsonBody('CreateCategoryRequest'),
        responses: { '201': itemResponse('Category', 'Created'), ...errorResponses },
      },
    },
    '/categories/{id}': {
      get: {
        tags: ['Categories'],
        summary: 'Get a category',
        security: cookieAuth,
        parameters: [idPath()],
        responses: { '200': itemResponse('Category'), ...errorResponses },
      },
      patch: {
        tags: ['Categories'],
        summary: 'Update a category (Admin/Editor)',
        security: cookieAuth,
        parameters: [idPath()],
        requestBody: jsonBody('UpdateCategoryRequest'),
        responses: { '200': itemResponse('Category'), ...errorResponses },
      },
      delete: {
        tags: ['Categories'],
        summary: 'Delete an unused category (Admin/Editor)',
        description: 'Returns `409 RESOURCE_IN_USE` while posts or child categories reference it.',
        security: cookieAuth,
        parameters: [idPath()],
        responses: { '204': { description: 'Deleted' }, ...errorResponses },
      },
    },
    '/posts': {
      get: {
        tags: ['Posts'],
        summary: 'Filtered, paginated staff post list',
        description: 'Authors are scoped to their own posts at the SQL level.',
        security: cookieAuth,
        parameters: [
          ...pageParams,
          {
            name: 'status',
            in: 'query',
            required: false,
            schema: {
              type: 'string',
              enum: ['DRAFT', 'IN_REVIEW', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED'],
            },
          },
          { name: 'categoryId', in: 'query', required: false, schema: { type: 'integer' } },
          { name: 'authorId', in: 'query', required: false, schema: { type: 'integer' } },
          { name: 'q', in: 'query', required: false, schema: { type: 'string' } },
          {
            name: 'sort',
            in: 'query',
            required: false,
            schema: {
              type: 'string',
              enum: ['updatedAt', 'createdAt', 'publishedAt', 'subject', 'readsCount', 'status'],
            },
          },
          {
            name: 'order',
            in: 'query',
            required: false,
            schema: { type: 'string', enum: ['asc', 'desc'] },
          },
        ],
        responses: { '200': listResponse('PostSummary'), ...errorResponses },
      },
      post: {
        tags: ['Posts'],
        summary: 'Create a draft',
        description: 'The author is always the caller; `authorId` is never read from the payload.',
        security: cookieAuth,
        requestBody: jsonBody('CreatePostRequest'),
        responses: { '201': itemResponse('Post', 'Created'), ...errorResponses },
      },
    },
    '/posts/{id}': {
      get: {
        tags: ['Posts'],
        summary: 'Get an editable post',
        security: cookieAuth,
        parameters: [idPath()],
        responses: { '200': itemResponse('Post'), ...errorResponses },
      },
      patch: {
        tags: ['Posts'],
        summary: 'Version-checked update',
        description:
          'Requires `expectedVersion`. A stale value returns `409 VERSION_CONFLICT` with the current version and leaves every table untouched.',
        security: cookieAuth,
        parameters: [idPath()],
        requestBody: jsonBody('UpdatePostRequest'),
        responses: { '200': itemResponse('Post'), ...errorResponses },
      },
      delete: {
        tags: ['Posts'],
        summary: 'Soft delete (Admin/Editor)',
        security: cookieAuth,
        parameters: [idPath()],
        requestBody: jsonBody('DeletePostRequest'),
        responses: { '204': { description: 'Deleted' }, ...errorResponses },
      },
    },
    ...workflowPaths(),
    '/posts/{id}/revisions': {
      get: {
        tags: ['Revisions'],
        summary: 'List revisions',
        security: cookieAuth,
        parameters: [idPath()],
        responses: {
          '200': jsonResponse('Revisions', {
            type: 'object',
            properties: { data: { type: 'array', items: ref('RevisionSummary') } },
          }),
          ...errorResponses,
        },
      },
    },
    '/posts/{id}/revisions/{revisionId}': {
      get: {
        tags: ['Revisions'],
        summary: 'Get one revision',
        security: cookieAuth,
        parameters: [idPath(), idPath('revisionId')],
        responses: { '200': itemResponse('Revision'), ...errorResponses },
      },
    },
    '/posts/{id}/revisions/{revisionId}/restore': {
      post: {
        tags: ['Revisions'],
        summary: 'Restore a revision as a new version (Admin/Editor)',
        description: 'History is append-only; existing revision rows are never modified.',
        security: cookieAuth,
        parameters: [idPath(), idPath('revisionId')],
        requestBody: jsonBody('RestoreRevisionRequest'),
        responses: { '200': itemResponse('Post'), ...errorResponses },
      },
    },
    '/menus': {
      get: {
        tags: ['Menus'],
        summary: 'List menus with their item trees (Admin/Editor)',
        security: cookieAuth,
        responses: {
          '200': jsonResponse('Menus', {
            type: 'object',
            properties: { data: { type: 'array', items: ref('Menu') } },
          }),
          ...errorResponses,
        },
      },
    },
    '/menus/{id}': {
      get: {
        tags: ['Menus'],
        summary: 'Get a menu tree (Admin/Editor)',
        security: cookieAuth,
        parameters: [idPath()],
        responses: { '200': itemResponse('Menu'), ...errorResponses },
      },
    },
    '/menus/{id}/items': {
      post: {
        tags: ['Menus'],
        summary: 'Add a menu item (Admin/Editor)',
        security: cookieAuth,
        parameters: [idPath()],
        requestBody: jsonBody('CreateMenuItemRequest'),
        responses: { '201': itemResponse('Menu', 'Updated menu'), ...errorResponses },
      },
    },
    '/menus/{id}/items/{itemId}': {
      patch: {
        tags: ['Menus'],
        summary: 'Edit a menu item (Admin/Editor)',
        security: cookieAuth,
        parameters: [idPath(), idPath('itemId')],
        requestBody: jsonBody('UpdateMenuItemRequest'),
        responses: { '200': itemResponse('Menu'), ...errorResponses },
      },
      delete: {
        tags: ['Menus'],
        summary: 'Delete a menu item and its subtree (Admin/Editor)',
        security: cookieAuth,
        parameters: [idPath(), idPath('itemId')],
        responses: { '200': itemResponse('Menu'), ...errorResponses },
      },
    },
    '/menus/{id}/reorder': {
      put: {
        tags: ['Menus'],
        summary: 'Atomically reorder a whole menu (Admin/Editor)',
        description:
          'The payload must contain every current item exactly once. Cycles, duplicate sibling positions, foreign ids and missing items reject the entire request with `409 INVALID_MENU_TREE`.',
        security: cookieAuth,
        parameters: [idPath()],
        requestBody: jsonBody('ReorderMenuRequest'),
        responses: { '200': itemResponse('Menu'), ...errorResponses },
      },
    },
    '/media': {
      get: {
        tags: ['Media'],
        summary: 'List image assets (staff)',
        security: cookieAuth,
        parameters: pageParams,
        responses: { '200': listResponse('MediaAsset'), ...errorResponses },
      },
      post: {
        tags: ['Media'],
        summary: 'Upload an image (staff)',
        description:
          'multipart/form-data with `file` and optional `altText`. The real type is detected from magic bytes and confirmed by decoding; JPEG, PNG and WebP only. SVG is rejected. Maximum size comes from MAX_UPLOAD_BYTES.',
        security: cookieAuth,
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: {
                  file: { type: 'string', format: 'binary' },
                  altText: { type: 'string', maxLength: 300 },
                },
                required: ['file'],
              },
            },
          },
        },
        responses: {
          '201': itemResponse('MediaAsset', 'Uploaded'),
          '413': jsonResponse('File too large', ref('ErrorResponse')),
          '415': jsonResponse('Unsupported media type', ref('ErrorResponse')),
          ...errorResponses,
        },
      },
    },
    '/media/{id}': {
      patch: {
        tags: ['Media'],
        summary: 'Edit alt text',
        security: cookieAuth,
        parameters: [idPath()],
        requestBody: jsonBody('UpdateMediaRequest'),
        responses: { '200': itemResponse('MediaAsset'), ...errorResponses },
      },
      delete: {
        tags: ['Media'],
        summary: 'Delete an unreferenced asset (Admin/Editor)',
        security: cookieAuth,
        parameters: [idPath()],
        responses: { '204': { description: 'Deleted' }, ...errorResponses },
      },
    },
    '/media/{id}/file': {
      get: {
        tags: ['Media'],
        summary: 'Stream an asset (authenticated)',
        security: cookieAuth,
        parameters: [idPath()],
        responses: { '200': { description: 'Image bytes' }, ...errorResponses },
      },
    },
    '/settings': {
      get: {
        tags: ['Settings'],
        summary: 'Get editable settings (Admin)',
        security: cookieAuth,
        responses: { '200': itemResponse('SiteSettings'), ...errorResponses },
      },
      patch: {
        tags: ['Settings'],
        summary: 'Update settings (Admin)',
        security: cookieAuth,
        requestBody: jsonBody('UpdateSettingsRequest'),
        responses: { '200': itemResponse('SiteSettings'), ...errorResponses },
      },
    },
    '/audit-logs': {
      get: {
        tags: ['Audit'],
        summary: 'Filtered audit entries (Admin)',
        security: cookieAuth,
        parameters: [
          ...pageParams,
          { name: 'actorId', in: 'query', required: false, schema: { type: 'integer' } },
          { name: 'action', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'entityType', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'entityId', in: 'query', required: false, schema: { type: 'string' } },
          {
            name: 'from',
            in: 'query',
            required: false,
            schema: { type: 'string', format: 'date-time' },
          },
          {
            name: 'to',
            in: 'query',
            required: false,
            schema: { type: 'string', format: 'date-time' },
          },
        ],
        responses: { '200': listResponse('AuditLogEntry'), ...errorResponses },
      },
    },
    '/public/settings': {
      get: {
        tags: ['Public'],
        summary: 'Safe public site settings',
        security: [],
        responses: { '200': itemResponse('PublicSiteSettings') },
      },
    },
    '/public/menus/{location}': {
      get: {
        tags: ['Public'],
        summary: 'Resolved visible menu tree',
        description:
          'Items whose target is unpublished, archived, deleted or inactive are omitted.',
        security: [],
        parameters: [
          {
            name: 'location',
            in: 'path',
            required: true,
            schema: { type: 'string', enum: ['HEADER', 'FOOTER'] },
          },
        ],
        responses: { '200': jsonResponse('Menu tree', { type: 'object' }) },
      },
    },
    '/public/categories': {
      get: {
        tags: ['Public'],
        summary: 'Active categories',
        security: [],
        responses: {
          '200': jsonResponse('Categories', {
            type: 'object',
            properties: { data: { type: 'array', items: ref('PublicCategory') } },
          }),
        },
      },
    },
    '/public/categories/{slug}/posts': {
      get: {
        tags: ['Public'],
        summary: 'Published posts in a category',
        security: [],
        parameters: [
          { name: 'slug', in: 'path', required: true, schema: { type: 'string' } },
          ...pageParams,
        ],
        responses: { '200': listResponse('PublicPostSummary') },
      },
    },
    '/public/posts': {
      get: {
        tags: ['Public'],
        summary: 'List or search published posts',
        description:
          'Supplying `q` switches to FTS5 search, with a LIKE fallback when FTS5 is unavailable.',
        security: [],
        parameters: [
          ...pageParams,
          { name: 'q', in: 'query', required: false, schema: { type: 'string', maxLength: 120 } },
          { name: 'category', in: 'query', required: false, schema: { type: 'string' } },
        ],
        responses: { '200': listResponse('PublicPostSummary') },
      },
    },
    '/public/posts/{slug}': {
      get: {
        tags: ['Public'],
        summary: 'Published post detail',
        description: 'Returns 404 for any post that is not currently publicly visible.',
        security: [],
        parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': itemResponse('PublicPost'),
          '404': jsonResponse('Not found or not public', ref('ErrorResponse')),
        },
      },
    },
    '/public/posts/{slug}/view': {
      post: {
        tags: ['Public'],
        summary: 'Record a de-duplicated read',
        description:
          'Idempotent per (post, visitor cookie, UTC day). Only the HMAC of the opaque visitor cookie is stored; no IP address is recorded.',
        security: [],
        parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': itemResponse('ViewResult'),
          '404': jsonResponse('Not found or not public', ref('ErrorResponse')),
          '429': jsonResponse('Rate limited', ref('ErrorResponse')),
        },
      },
    },
    '/public/media/{id}/file': {
      get: {
        tags: ['Public'],
        summary: 'Stream media referenced by public content',
        security: [],
        parameters: [idPath()],
        responses: {
          '200': { description: 'Image bytes' },
          '404': jsonResponse('Not found', ref('ErrorResponse')),
        },
      },
    },
    '/internal/jobs/publish-scheduled': {
      post: {
        tags: ['System'],
        summary: 'Publish due scheduled posts',
        description:
          'Requires `Authorization: Bearer <SCHEDULE_JOB_SECRET>`. Idempotent: a repeated run publishes nothing.',
        security: [{ jobSecret: [] }],
        responses: {
          '200': jsonResponse('Run summary', { type: 'object' }),
          '401': jsonResponse('Missing or invalid job secret', ref('ErrorResponse')),
        },
      },
    },
  };
}

function workflowPaths(): JsonObject {
  const actions: Array<[string, string, string]> = [
    ['submit', 'Submit for review', 'Draft → In review. Owner author, Editor or Admin.'],
    [
      'request-changes',
      'Request changes',
      'In review → Draft. Editor/Admin only; a 3–2000 character comment is required.',
    ],
    ['publish', 'Publish', 'In review or Scheduled → Published. The server sets `publishedAt`.'],
    ['schedule', 'Schedule', 'In review → Scheduled. Requires a future `scheduledAt`.'],
    ['cancel-schedule', 'Cancel a schedule', 'Scheduled → Draft.'],
    ['archive', 'Archive', 'Published → Archived.'],
    ['restore-draft', 'Restore to draft', 'Archived → Draft.'],
  ];

  const paths: JsonObject = {};
  for (const [action, summary, description] of actions) {
    paths[`/posts/{id}/${action}`] = {
      post: {
        tags: ['Workflow'],
        summary,
        description: `${description} Requires \`expectedVersion\`; the transition, version bump, revision snapshot, workflow event and audit entry all share one transaction.`,
        security: cookieAuth,
        parameters: [idPath()],
        requestBody: jsonBody('WorkflowActionRequest'),
        responses: {
          ...errorResponses,
          '200': itemResponse('Post'),
          '409': jsonResponse('Version conflict or invalid state transition', ref('ErrorResponse')),
        },
      },
    };
  }
  return paths;
}

let cachedDocument: JsonObject | null = null;

export function buildOpenApiDocument(): JsonObject {
  if (cachedDocument) return cachedDocument;

  const env = getEnv();
  const schemas = buildSchemas();

  // Schemas that only appear as request bodies are registered lazily here.
  const extras: Array<[string, z.ZodTypeAny]> = [];
  for (const [name, schema] of extras) {
    schemas[name] = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as JsonObject;
  }

  cachedDocument = {
    openapi: '3.1.0',
    info: {
      title: 'PublishFlow CMS API',
      version: '1.0.0',
      description: [
        'Versioned HTTP API for PublishFlow CMS.',
        '',
        '**Authentication** uses an opaque, database-backed session cookie set by `POST /auth/login`.',
        'Only a hash of the token is stored server-side, so sessions can be revoked immediately.',
        '',
        '**CSRF**: every unsafe request (POST/PUT/PATCH/DELETE) from a cookie-authenticated client must send',
        'the `X-CSRF-Token` header matching the readable `pf_csrf` cookie. Fetch it from `GET /auth/csrf`.',
        '',
        '**Optimistic locking**: every post mutation requires `expectedVersion`. A stale value returns',
        '`409 VERSION_CONFLICT` and changes nothing.',
        '',
        '**Roles**: ADMIN (everything), EDITOR (all content, categories, menus, media),',
        'AUTHOR (own drafts only). Authorization is enforced in the service layer, not the UI.',
      ].join('\n'),
    },
    servers: [{ url: `${env.APP_URL.replace(/\/+$/, '')}/api/v1`, description: 'This instance' }],
    tags: [
      { name: 'System', description: 'Health and internal jobs' },
      { name: 'Authentication', description: 'Sessions, CSRF and password changes' },
      { name: 'Users', description: 'Staff account administration (Admin only)' },
      { name: 'Categories', description: 'Content classification' },
      { name: 'Posts', description: 'Editorial CRUD with optimistic locking' },
      { name: 'Workflow', description: 'Draft → review → publication → archive transitions' },
      { name: 'Revisions', description: 'Append-only version history' },
      { name: 'Menus', description: 'Header and footer navigation' },
      { name: 'Media', description: 'Validated image uploads' },
      { name: 'Settings', description: 'Site identity and defaults' },
      { name: 'Audit', description: 'Security-relevant action trail' },
      { name: 'Public', description: 'Unauthenticated read API for the public site' },
    ],
    components: {
      securitySchemes: {
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: env.SESSION_COOKIE_NAME,
          description: 'Opaque session cookie issued by POST /auth/login.',
        },
        jobSecret: {
          type: 'http',
          scheme: 'bearer',
          description: 'SCHEDULE_JOB_SECRET, for the internal publishing job only.',
        },
      },
      schemas,
    },
    security: cookieAuth,
    paths: buildPaths(),
  };

  return cachedDocument;
}
