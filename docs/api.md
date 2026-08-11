# API reference

Base path: `/api/v1`. Interactive docs at `/api/v1/docs`; the generated OpenAPI
3.1 document is at `/api/v1/openapi.json`.

---

## Conventions

**Single resource**

```json
{ "data": { "id": 1 } }
```

**List**

```json
{
  "data": [],
  "meta": { "page": 1, "pageSize": 20, "total": 0, "totalPages": 0 }
}
```

**Error**

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The request contains invalid fields.",
    "details": { "subject": ["Subject must contain at least 3 characters."] },
    "requestId": "req_01J..."
  }
}
```

Every response carries an `X-Request-Id` header matching `error.requestId`.

---

## Authentication

Cookie-based. `POST /auth/login` sets two cookies:

| Cookie       | Flags                                              | Purpose                                           |
| ------------ | -------------------------------------------------- | ------------------------------------------------- |
| `pf_session` | `HttpOnly`, `SameSite=Lax`, `Secure` in production | The session token. `__Host-` prefixed over HTTPS. |
| `pf_csrf`    | readable by JavaScript                             | The double-submit CSRF token.                     |

Every unsafe request (`POST`, `PUT`, `PATCH`, `DELETE`) from a cookie-authenticated
client must send `X-CSRF-Token` matching the `pf_csrf` cookie. Fetch a fresh one
from `GET /auth/csrf`.

Requests with no session cookie skip the CSRF check — there is no ambient
authority to abuse — so the internal job endpoint and API clients work normally.

---

## Status codes

| Status | Meaning                                                               |
| ------ | --------------------------------------------------------------------- |
| `200`  | Successful read, update or action                                     |
| `201`  | Resource created                                                      |
| `204`  | Success with no body                                                  |
| `400`  | Malformed request (e.g. invalid JSON)                                 |
| `401`  | Not authenticated, or invalid credentials                             |
| `403`  | Authenticated but not permitted, or CSRF failure                      |
| `404`  | Not found, or not visible to this caller                              |
| `409`  | Version conflict, illegal transition, duplicate slug, resource in use |
| `413`  | Body or upload too large                                              |
| `415`  | File type not allowed                                                 |
| `422`  | Schema or domain validation failed                                    |
| `429`  | Rate limited                                                          |
| `500`  | Unexpected server error                                               |
| `503`  | Database busy after a bounded retry                                   |

## Error codes

| Code                       | HTTP | Meaning                              |
| -------------------------- | ---- | ------------------------------------ |
| `VALIDATION_ERROR`         | 422  | Zod or domain validation failed      |
| `AUTH_INVALID_CREDENTIALS` | 401  | Generic login failure                |
| `AUTH_REQUIRED`            | 401  | Missing or invalid session           |
| `SESSION_EXPIRED`          | 401  | Session past its expiry              |
| `CSRF_FAILED`              | 403  | Unsafe cross-site request            |
| `FORBIDDEN`                | 403  | Authenticated but unauthorized       |
| `NOT_FOUND`                | 404  | Not found or hidden                  |
| `EMAIL_EXISTS`             | 409  | Email already in use                 |
| `SLUG_EXISTS`              | 409  | Slug already in use                  |
| `VERSION_CONFLICT`         | 409  | Stale `expectedVersion`              |
| `INVALID_STATE_TRANSITION` | 409  | Illegal workflow transition          |
| `RESOURCE_IN_USE`          | 409  | Referenced entity cannot be removed  |
| `LAST_ACTIVE_ADMIN`        | 409  | Would remove the final administrator |
| `INVALID_MENU_TREE`        | 409  | Cycle, depth, ordering or tree error |
| `UNSUPPORTED_MEDIA_TYPE`   | 415  | Actual file type not allowed         |
| `FILE_TOO_LARGE`           | 413  | Exceeds the configured maximum       |
| `RATE_LIMITED`             | 429  | Too many requests                    |
| `DATABASE_BUSY`            | 503  | Write could not complete             |
| `INTERNAL_ERROR`           | 500  | Unexpected failure                   |

---

## Endpoints

### System

| Method | Endpoint                           | Access        | Purpose                     |
| ------ | ---------------------------------- | ------------- | --------------------------- |
| GET    | `/health`                          | Public        | Process and database check  |
| GET    | `/openapi.json`                    | Public        | Generated OpenAPI document  |
| GET    | `/docs`                            | Public        | Interactive documentation   |
| POST   | `/internal/jobs/publish-scheduled` | Bearer secret | Publish due scheduled posts |

### Authentication

| Method | Endpoint                | Access        | Purpose                                    |
| ------ | ----------------------- | ------------- | ------------------------------------------ |
| POST   | `/auth/login`           | Public        | Create a session                           |
| POST   | `/auth/logout`          | Authenticated | Revoke the current session                 |
| GET    | `/auth/me`              | Authenticated | Current user                               |
| GET    | `/auth/csrf`            | Authenticated | Issue a session-bound CSRF token           |
| POST   | `/auth/change-password` | Authenticated | Change own password, revoke other sessions |

### Users — Admin only

| Method | Endpoint                    | Purpose                             |
| ------ | --------------------------- | ----------------------------------- |
| GET    | `/users`                    | Paginated, filterable list          |
| POST   | `/users`                    | Create a user                       |
| GET    | `/users/:id`                | Get a user                          |
| PATCH  | `/users/:id`                | Update name, role or status         |
| POST   | `/users/:id/reset-password` | Set a new password, revoke sessions |

### Categories

| Method | Endpoint          | Access       | Purpose                 |
| ------ | ----------------- | ------------ | ----------------------- |
| GET    | `/categories`     | Staff        | List with post counts   |
| POST   | `/categories`     | Admin/Editor | Create                  |
| GET    | `/categories/:id` | Staff        | Get one                 |
| PATCH  | `/categories/:id` | Admin/Editor | Update                  |
| DELETE | `/categories/:id` | Admin/Editor | Delete only when unused |

### Posts

| Method | Endpoint                     | Access          | Purpose                                    |
| ------ | ---------------------------- | --------------- | ------------------------------------------ |
| GET    | `/posts`                     | Staff           | Filtered list (authors see only their own) |
| POST   | `/posts`                     | Staff           | Create a draft                             |
| GET    | `/posts/:id`                 | Permitted staff | Get for editing                            |
| PATCH  | `/posts/:id`                 | Permitted staff | Version-checked update                     |
| DELETE | `/posts/:id`                 | Admin/Editor    | Soft delete                                |
| GET    | `/posts/:id/workflow-events` | Permitted staff | Status history                             |

Query parameters for `GET /posts`:

```text
?page=1&pageSize=20&status=IN_REVIEW&categoryId=3&authorId=8
&q=search+text&sort=updatedAt&order=desc
```

`sort` is resolved against an allow-list (`updatedAt`, `createdAt`,
`publishedAt`, `subject`, `readsCount`, `status`); anything else falls back to
the default. User input never becomes a column name.

### Workflow

All take `{ "expectedVersion": number, "comment"?: string }`.

| Method | Endpoint                     | Access             | Transition                                                |
| ------ | ---------------------------- | ------------------ | --------------------------------------------------------- |
| POST   | `/posts/:id/submit`          | Owner/Editor/Admin | Draft → In review                                         |
| POST   | `/posts/:id/request-changes` | Editor/Admin       | In review → Draft (**comment required**, 3–2000 chars)    |
| POST   | `/posts/:id/publish`         | Editor/Admin       | In review or Scheduled → Published                        |
| POST   | `/posts/:id/schedule`        | Editor/Admin       | In review → Scheduled (**future `scheduledAt` required**) |
| POST   | `/posts/:id/cancel-schedule` | Editor/Admin       | Scheduled → Draft                                         |
| POST   | `/posts/:id/archive`         | Editor/Admin       | Published → Archived                                      |
| POST   | `/posts/:id/restore-draft`   | Editor/Admin       | Archived → Draft                                          |

Each successful action increments the version and writes a revision, a workflow
event and an audit entry in one transaction.

### Revisions

| Method | Endpoint                                   | Access          | Purpose                  |
| ------ | ------------------------------------------ | --------------- | ------------------------ |
| GET    | `/posts/:id/revisions`                     | Permitted staff | List                     |
| GET    | `/posts/:id/revisions/:revisionId`         | Permitted staff | Get one                  |
| POST   | `/posts/:id/revisions/:revisionId/restore` | Admin/Editor    | Restore as a new version |

### Menus — Admin/Editor

| Method | Endpoint                   | Purpose                            |
| ------ | -------------------------- | ---------------------------------- |
| GET    | `/menus`                   | All menus with resolved item trees |
| GET    | `/menus/:id`               | One menu tree                      |
| POST   | `/menus/:id/items`         | Add an item                        |
| PATCH  | `/menus/:id/items/:itemId` | Edit an item                       |
| DELETE | `/menus/:id/items/:itemId` | Delete an item and its subtree     |
| PUT    | `/menus/:id/reorder`       | Atomically reorder the whole menu  |

### Media

| Method | Endpoint                 | Access             | Purpose                                        |
| ------ | ------------------------ | ------------------ | ---------------------------------------------- |
| GET    | `/media`                 | Staff              | List image assets                              |
| POST   | `/media`                 | Staff              | Upload (multipart: `file`, optional `altText`) |
| PATCH  | `/media/:id`             | Owner/Admin/Editor | Edit alt text                                  |
| DELETE | `/media/:id`             | Admin/Editor       | Delete when unreferenced                       |
| GET    | `/media/:id/file`        | Staff              | Authenticated preview                          |
| GET    | `/public/media/:id/file` | Public             | Only media reachable from public content       |

Accepted: `image/jpeg`, `image/png`, `image/webp`. Detected from magic bytes and
confirmed by decoding — the declared `Content-Type` and the filename are ignored
for security decisions. SVG is rejected.

### Settings — Admin only

| Method | Endpoint    | Purpose                                           |
| ------ | ----------- | ------------------------------------------------- |
| GET    | `/settings` | Editable settings                                 |
| PATCH  | `/settings` | Update (`updatedBy`/`updatedAt` are server-owned) |

### Audit — Admin only

| Method | Endpoint             | Purpose                                     |
| ------ | -------------------- | ------------------------------------------- |
| GET    | `/audit-logs`        | Filter by actor, action, entity, date range |
| GET    | `/audit-logs/facets` | Distinct actions and entity types           |

### Public

| Method | Endpoint                         | Purpose                                      |
| ------ | -------------------------------- | -------------------------------------------- |
| GET    | `/public/settings`               | Safe site settings                           |
| GET    | `/public/menus/:location`        | Resolved visible menu (`HEADER` or `FOOTER`) |
| GET    | `/public/categories`             | Active categories with visible post counts   |
| GET    | `/public/categories/:slug/posts` | Published posts in a category                |
| GET    | `/public/posts`                  | List, or search when `q` is supplied         |
| GET    | `/public/posts/:slug`            | Published post detail                        |
| POST   | `/public/posts/:slug/view`       | Idempotent daily view count                  |

---

## Worked example: a version conflict

```http
PATCH /api/v1/posts/12
Content-Type: application/json
X-CSRF-Token: <token>

{ "expectedVersion": 4, "subject": "Updated subject" }
```

If someone else already saved version 5:

```http
HTTP/1.1 409 Conflict
X-Request-Id: req_01JABCDEF
```

```json
{
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "This post was changed by another user. Reload before saving.",
    "details": {
      "expectedVersion": 4,
      "currentVersion": 5,
      "updatedAt": "2026-08-10T12:00:00.000Z"
    },
    "requestId": "req_01JABCDEF"
  }
}
```

Nothing was written. No revision was created. The client is expected to keep the
user's text and offer a reload.

---

## Fields the API never accepts

Regardless of what a payload contains, these are always server-owned:

- `passwordHash`, session token hashes
- the acting user's role or permissions
- `readsCount`
- `publishedAt`, `createdAt`, `updatedAt`
- `authorId` on post create/update
- audit actor, revision saver, workflow actor
- media storage keys and filesystem paths

Sending them is not an error — they are simply ignored, and integration tests
assert that.
