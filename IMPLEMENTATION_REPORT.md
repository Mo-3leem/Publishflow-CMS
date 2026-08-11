# Implementation report

PublishFlow CMS, built against `CMS_CLAUDE_CODE_MASTER_SPEC.md`.

Every command listed under "Commands executed" below was actually run, and the
output quoted is what it printed. Where something was not verified, it says so.

---

## 1. What was built

A working editorial CMS: public website, admin dashboard, versioned HTTP API,
SQLite persistence, tests, Docker and CI. No placeholders, mock data layers or
non-functional controls.

### P0 — all complete

| Requirement                                       | Status | Where                                                     |
| ------------------------------------------------- | ------ | --------------------------------------------------------- |
| Authentication and logout                         | Done   | `src/server/services/auth-service.ts`, `src/server/auth/` |
| Admin / Editor / Author roles                     | Done   | `src/lib/permissions.ts`, enforced in every service       |
| User management by Admin                          | Done   | `user-service.ts`, `/admin/users`                         |
| Category CRUD                                     | Done   | `category-service.ts`, `/admin/categories`                |
| Post CRUD with ownership                          | Done   | `post-service.ts`, `/admin/posts`                         |
| Workflow Draft → In Review → Published → Archived | Done   | `workflow-service.ts`, `src/lib/workflow.ts`              |
| Revision history and restore                      | Done   | `revision-service.ts`, `/admin/posts/[id]/revisions`      |
| Optimistic locking                                | Done   | `expectedVersion` on every post mutation                  |
| Public home / category / post pages               | Done   | `src/app/(public)/`                                       |
| Header and footer menus, ordering and nesting     | Done   | `menu-service.ts`, `/admin/menus`                         |
| Site settings including logo                      | Done   | `settings-service.ts`, `/admin/settings`                  |
| Image media upload                                | Done   | `media-service.ts`, `/admin/media`                        |
| Read de-duplication per browser/post/day          | Done   | `view-service.ts`                                         |
| Admin list filtering, pagination, search          | Done   | URL-backed filters on `/admin/posts`                      |
| Consistent API validation and errors              | Done   | `contracts/`, `middleware/error-handler.ts`               |
| Unit and integration tests                        | Done   | 248 tests                                                 |
| Migrations and seed data                          | Done   | `drizzle/`, `src/server/db/seed-data.ts`                  |
| README, `.env.example`, Docker                    | Done   | this repository                                           |

### P1 — all complete

| Requirement                      | Status | Notes                                                                                                                                           |
| -------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Scheduled publishing             | Done   | CLI (`pnpm jobs:publish-scheduled`) **and** `POST /api/v1/internal/jobs/publish-scheduled` behind a bearer secret; idempotency covered by tests |
| FTS5 search with safe fallback   | Done   | FTS5 active in this environment; the `LIKE` fallback path is implemented and exercised                                                          |
| Audit log screen                 | Done   | `/admin/audit`, Admin only, filterable                                                                                                          |
| SEO, Open Graph, sitemap, robots | Done   | `generateMetadata`, `src/app/sitemap.ts`, `src/app/robots.ts`                                                                                   |
| Staff-only preview               | Done   | Draft/in-review content is reachable only through the authenticated admin editor and its preview pane; public routes 404                        |
| Dashboard statistics             | Done   | `dashboard-service.ts`, one grouped query rather than one per card                                                                              |
| OpenAPI JSON + interactive docs  | Done   | `/api/v1/openapi.json` (42 paths), `/api/v1/docs`                                                                                               |

### P2 — not implemented

Deliberately left out, as the specification permits only after P0/P1 pass:
drag-and-drop menu ordering (accessible button controls are implemented
instead), tags, autosave, password-reset email, responsive image variants,
import/export, dark mode.

---

## 2. Architecture and key decisions

Full reasoning in [`docs/architecture-decisions.md`](docs/architecture-decisions.md).
The decisions that shaped the code most:

1. **Modular monolith.** Next.js App Router + Hono at `/api/v1` + a services
   layer. Publishing a post writes four tables in one SQLite transaction; as
   separate services that would be a saga for no benefit.
2. **Two data paths, on purpose.** Public Server Components call services
   directly (no self-HTTP). Admin screens call the Hono API, so the UI exercises
   the same authorization an external client would hit.
3. **Optimistic locking.** `WHERE id = ? AND version = ?`. Zero affected rows is
   a `409`, never a silent overwrite. The version bump and the revision snapshot
   share one transaction, so history cannot disagree with the current row.
4. **Append-only revisions.** Restore writes old content _forward_ as a new
   version, and restores content only — never `status` or `publishedAt`, so
   recovering text cannot silently republish an archived post.
5. **Opaque DB-backed sessions.** Only `HMAC(SESSION_SECRET, token)` is stored.
   Revocation is immediate and transactional.
6. **One `publicVisibility()` predicate** composed into every public query. The
   realistic leak is a future endpoint forgetting a condition; with one
   definition, that requires deliberately not using it.
7. **Markdown without raw HTML.** No `rehype-raw`, no `dangerouslySetInnerHTML`
   anywhere. There is no HTML sink to sanitise.

### Deviations from the specification

Three, each forced and each documented:

| Spec said                  | What was done                                                             | Why                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@hono/zod-openapi`        | Plain `zod` + `z.toJSONSchema` + `@hono/swagger-ui`                       | Its published types do not resolve under `moduleResolution: bundler` with Zod v4 — `.refine()` callbacks degraded to `any` and broke `strict` typechecking. Only `z` and route metadata were needed. The requirement ("generate OpenAPI 3 from the same Zod schemas used for validation", plus a Hono-compatible UI) is still met, with one dependency fewer. ADR-011. |
| Node.js 24                 | `.nvmrc` pins `24`; CI runs 24; local development ran on Node 22.17.0 LTS | Node 24 is not installed on this machine and no version manager is present. `engines` allows `>=22.11.0`. CI is the authority and uses `.nvmrc`.                                                                                                                                                                                                                       |
| Latest TypeScript / ESLint | TypeScript 5.9.3, ESLint 9.39.5                                           | The spec requires _mutually compatible_ stable versions. `typescript-eslint` does not support TS 7 yet, and `eslint-plugin-react` (a dependency of `eslint-config-next` 16) does not support ESLint 10. TS 7 + ESLint 10 install cleanly but make `pnpm lint` impossible.                                                                                              |

One further engineering choice worth flagging: **E2E runs the production build
through `next start`, not the standalone bundle.** `output: 'standalone'` is
configured and is what the Docker image ships, but the standalone bundle trips
over pnpm's symlinked store on Windows (`EPERM`). CI's `docker` job builds the
image and health-checks the running container, so the standalone artifact is
still verified — just not on the developer's machine. ADR-015.

---

## 3. Bugs found and fixed during the build

Recorded because they are the kind of thing that silently ships:

1. **Category post counts always showed 0.** Drizzle omits table qualification in
   a single-table select, so `${categories.id}` inside a raw `sql` correlated
   subquery rendered as a bare `"id"`. SQLite then silently degrades an
   unresolvable double-quoted identifier to a _string literal_, making the
   comparison always false — no error, just wrong numbers. Rewritten as a grouped
   query; the trap is documented in `CLAUDE.md`.
2. **`Pagination` crashed the audit and posts screens.** It was marked
   `'use client'` but received a `buildHref` callback from a Server Component
   ("Functions cannot be passed directly to Client Components"). It has no state
   or handlers, so it is now a Server Component.
3. **Two guaranteed 401s on every login page load.** The CSRF prime ran in the
   admin-wide provider, including on `/admin/login` where no session exists.
   Moved into the authenticated shell.
4. **`getByLabel('Password', { exact: true })` could never match.** The required
   `*` marker lived inside `<label>`, making its text `"Password*"`. Moved outside
   the label — better for screen readers, and exact label matching now works.

---

## 4. Commands executed and their results

Run from a clean state, in this order, on Windows 11 with Node 22.17.0 and
pnpm 11.21.0.

| Command                                 | Result                                                                                                                                                                                                            |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install`                          | Success. Native modules (`better-sqlite3` 13.0.3, `argon2` 0.45.1, `sharp` 0.35.3) built and verified loadable.                                                                                                   |
| `pnpm db:reset`                         | `Removed 3 file(s)`                                                                                                                                                                                               |
| `pnpm db:migrate`                       | `Applied 2 migration(s): 0000_init.sql, 0001_fts.sql` · `Full-text search: FTS5 index active.`                                                                                                                    |
| `pnpm db:seed`                          | `users: 4, categories: 3, posts: 6, menu items: 8`                                                                                                                                                                |
| `pnpm db:check`                         | **All 9 checks passed** — `quick_check: ok`, `foreign_key_check: no violations`, foreign keys `ON`, singleton settings row, both menus, an active admin, every post has a revision, reads consistent, FTS5 active |
| `pnpm format:check`                     | `All matched files use Prettier code style!`                                                                                                                                                                      |
| `pnpm lint`                             | Clean — 0 errors, 0 warnings (`--max-warnings=0`)                                                                                                                                                                 |
| `pnpm typecheck`                        | Clean — 0 errors under `strict` + `noUncheckedIndexedAccess`                                                                                                                                                      |
| `pnpm test`                             | **248 passed / 248**, 10 files                                                                                                                                                                                    |
| `pnpm build`                            | Success, 20 routes, no warnings                                                                                                                                                                                   |
| `pnpm exec playwright install chromium` | Installed                                                                                                                                                                                                         |
| `pnpm test:e2e`                         | **12 passed / 12**                                                                                                                                                                                                |
| `pnpm jobs:publish-scheduled`           | `due posts: 0, published: 0, skipped: 0, failed: 0` (nothing due — correct on a fresh seed)                                                                                                                       |

### Test coverage by area

**Unit (95 tests)** — role capability matrix against the specification table;
every workflow transition, allowed and forbidden, for every role; slug
normalisation, validation and collision suffixing; URL-scheme safety including
`java\nscript:` smuggling and protocol-relative escapes; tree cycle and depth
validation; pagination clamping and sort allow-listing (including
`id; DROP TABLE posts`); UTC viewer-day keys; timezone round-trips; password
policy; FTS query escaping; and that Markdown renders `<script>` as text without
executing it.

**Integration (141 tests)** — driven through the real Hono app, so middleware,
validation, authorization and error mapping all run. Covers every case in the
specification's test matrix, including: identical errors for wrong password vs
unknown account; disabled users losing live sessions; authors unable to read,
edit, publish or delete others' posts; stale updates returning `409` **and
leaving the revision count unchanged**; restore creating a new version without
mutating stored rows; duplicate slugs; category deletion blocked while
referenced; last-active-admin safeguards; atomic menu reordering rejecting
missing/duplicate/foreign items; uploads rejected for spoofed extensions, wrong
magic bytes, oversized files, SVG and a PHP payload named `.png`; view
de-duplication; scheduled-publishing idempotency; CSRF including a token from
another session; and the OpenAPI document.

**E2E (12 tests, Chromium)** — the full editorial round trip; a genuine
two-browser-context save conflict asserting the typed text survives; revision
restore reflected on the public page; settings and menu-order changes reaching
the public header; read de-duplication across two browsers; authorization from
both the UI and direct API calls; the not-found page; robots/sitemap; and the
OpenAPI endpoint.

---

## 5. How to run it

```bash
pnpm install
cp .env.example .env
pnpm db:migrate
pnpm db:seed
pnpm dev
```

- Public site: <http://localhost:3000>
- Admin: <http://localhost:3000/admin>
- API docs: <http://localhost:3000/api/v1/docs>

Quality gates:

```bash
pnpm check       # format:check + lint + typecheck + test + build
pnpm test:e2e    # after pnpm build
pnpm db:check
```

Docker:

```bash
cp .env.example .env    # replace every "replace-with-..." value first
docker compose up --build -d
docker compose run --rm app node docker/seed.mjs   # create the first admin
```

---

## 6. Demo accounts

**Development only.** Passwords come from `.env`; these are the `.env.example`
defaults, and the application refuses to start in production while any secret
still holds a placeholder value.

| Role            | Email                       | Password                  |
| --------------- | --------------------------- | ------------------------- |
| Admin           | `admin@publishflow.local`   | `AdminDemo123!ChangeMe`   |
| Editor          | `editor@publishflow.local`  | `EditorDemo123!ChangeMe`  |
| Author          | `author@publishflow.local`  | `AuthorDemo123!ChangeMe`  |
| Author (second) | `author2@publishflow.local` | `Author2Demo123!ChangeMe` |

The second author exists so ownership rules are demonstrable: neither author can
see or edit the other's drafts.

Passwords are stored only as Argon2id hashes. `docker/seed.mjs` refuses to create
an administrator using the demo password.

---

## 7. Honest limitations

Things a reviewer should know, rather than discover:

1. **The Docker image was not built locally.** The Dockerfile, entrypoint,
   production migration runner, bootstrap script and Compose stack are all
   written, but the Docker daemon was not available on this machine, so
   `docker compose up --build` was never executed here. CI's `docker` job builds
   the image and boots the container against `/api/v1/health` — that job has not
   been observed running either, since there is no remote to push to.
2. **Node 24 was not used locally.** See the deviations table. `.nvmrc` pins 24
   and CI uses it; local development ran on Node 22.17.0 LTS.
3. **In-process rate limiting does not span replicas.** Correct for the
   single-instance design; a shared store would be needed to scale out. Login
   throttling is database-backed and does survive restarts.
4. **No Content-Security-Policy on HTML pages.** Next.js inline bootstrap scripts
   need nonce or hash plumbing to do properly. API responses do carry a strict CSP.
5. **No 2FA and no password-reset email flow.** Out of scope; an administrator
   resets passwords, which revokes the target's sessions.
6. **Uploads are not virus-scanned.** Type detection, decode verification and
   re-encoding cover the web-facing risks.
7. **A `configLoader` warning from Vite** appears on every `vitest` run
   (`vitest.config.ts` uses ESM syntax in a file loaded as CommonJS). It is
   cosmetic; renaming the file would break the layout the specification requires.
8. **SQLite is not encrypted at rest.** Use disk encryption or SQLCipher.

---

## 8. Acceptance criteria

Every item from specification §36, verified by the tests and commands above.

**Authentication and authorization** — staff log in and out; passwords stored
only as Argon2id hashes; disabled users cannot log in and lose live sessions;
server-side permission checks verified by direct API calls; the last active
administrator cannot be disabled or demoted.

**Content** — authors create and edit their own drafts and cannot publish;
editors and admins review and publish; invalid transitions rejected with `409
INVALID_STATE_TRANSITION`; public visitors see only published posts; slugs unique
and stable; lists paginated and filterable.

**Reliability** — every save creates a revision; revisions restore as new
versions; stale updates return `409` without side effects; multi-table changes
are transactional; foreign-key enforcement verified by `pnpm db:check`.

**Navigation and settings** — header and footer menus configurable; items link to
posts, categories or custom URLs; order and nesting preserved atomically; invalid
targets hidden publicly; admins update the site name and logo.

**Media and reads** — allowed images upload safely; disallowed types and
oversized files rejected; a refreshing browser adds at most one read per day;
reads cannot be modified through the post update API.

**P1** — scheduled publishing works through both CLI and protected endpoint and
is idempotent; FTS5 works with a tested fallback; audit log, authenticated
preview and dashboard statistics complete; SEO metadata, canonical URLs, sitemap
and robots generated; OpenAPI JSON and interactive docs cover the core routes.

**Engineering quality** — setup works from the README; migrations and seed run on
an empty database; typecheck, lint, format and tests pass; critical business
rules have integration tests; no secrets committed (173 tracked files, no `.env`,
no database, no uploads); Docker uses persistent volumes for database, uploads
and backups.
