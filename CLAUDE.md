# PublishFlow Development Instructions

Read `CMS_CLAUDE_CODE_MASTER_SPEC.md` for the full product requirements.
`docs/architecture-decisions.md` records why things are the way they are.

## Commands

- Install: `pnpm install`
- Dev: `pnpm dev`
- Migrate: `pnpm db:migrate`
- Seed: `pnpm db:seed`
- Reset the local database: `pnpm db:reset`
- Integrity check: `pnpm db:check`
- Full gate: `pnpm check` (format, lint, typecheck, test, build)
- E2E: `pnpm test:e2e` (run `pnpm build` first)

## Architecture

- Next.js App Router for the public site and the admin dashboard.
- Hono API under `/api/v1`, mounted by a thin catch-all route handler.
- Drizzle + SQLite; database modules are server-only.
- Route handlers are thin. Domain rules, authorization and transactions live in
  `src/server/services/`.
- Public Server Components call services directly; browser-interactive admin
  screens call the Hono API.
- `src/lib/` is pure and dependency-free — permissions, workflow, slugs, trees,
  pagination. It is where the unit tests point.

## Rules

- TypeScript strict mode, including `noUncheckedIndexedAccess`. No unjustified `any`.
- Enforce authorization in services, never only in components. Hiding a button
  is not a control.
- All post mutations require `expectedVersion`; a stale value is a `409`.
- Multi-table mutations share one transaction.
- Never expose secrets, password hashes, session tokens or raw database errors.
- Never import server or database modules into a client component.
- Content is Markdown with raw HTML disabled. Do not introduce `rehype-raw` or
  `dangerouslySetInnerHTML`.
- Return `404` rather than `403` when confirming existence would leak something.
- Run `pnpm check` and `pnpm test:e2e` before declaring work complete.

## Gotchas worth knowing

- **`server-only`** throws unless the `react-server` export condition is on. The
  tsx scripts pass `--conditions=react-server`; Vitest aliases the package to a
  stub instead, because enabling the condition globally would swap React for its
  RSC build and break jsdom tests.
- **Drizzle omits table qualification** in a single-table select. Interpolating
  `${table.column}` into a raw `sql` template inside a subquery produces a bare
  `"id"`, and SQLite silently degrades an unresolvable double-quoted identifier
  to a string literal — a comparison that is always false, with no error. Prefer
  a grouped query or a join over a correlated subquery.
- **`Pagination` is a Server Component on purpose.** It takes a `buildHref`
  callback; marking it `'use client'` would make that prop unserialisable.
- **Timestamps** are ISO 8601 UTC strings written by the application. SQL
  `CURRENT_TIMESTAMP` produces a different format that does not sort against
  them — always write through `nowIso()`.
