# Architecture decisions

Each entry records the decision, the alternatives considered, and what would
change it. Written to be argued with.

---

## ADR-001 — Modular monolith, not microservices

**Decision.** One Next.js process serving both the public site and the admin
dashboard, with a Hono API mounted at `/api/v1` and business logic in a services
layer.

**Why.** The domain has roughly ten entities and one write-heavy path
(publishing). Splitting it would buy independent deployment nobody needs and cost
distributed transactions. Publishing a post writes to `posts`, `post_revisions`,
`workflow_events` and `audit_logs`; as one process that is a single SQLite
transaction, and across services it would be a saga.

**Boundaries kept anyway.** Route handlers are thin, services own the rules,
`src/lib/` is pure and dependency-free. If a piece ever needs to move out, the
seam already exists.

**Would revisit if.** Content ingestion or media processing grew heavy enough to
need independent scaling.

---

## ADR-002 — SQLite as the only database

**Decision.** SQLite via `better-sqlite3`, WAL mode, foreign keys on, 5-second
busy timeout.

**Why.** The brief calls for it, and it is genuinely a good fit: a read-heavy
CMS on a single instance. It gives real transactions, `CHECK` constraints,
partial indexes and FTS5, with no service to operate. `better-sqlite3` is
synchronous, which removes a whole class of interleaving bugs from transactional
code.

**The honest limit.** One writer at a time. Fine for an editorial team; wrong for
many concurrent writers. The read path is unaffected — WAL lets readers continue
during a write.

**Migration path.** PostgreSQL. Drizzle keeps most query code portable; the real
work is timestamp handling (SQLite has no date type — see ADR-006) and the
partial index in `0000_init.sql`.

**Would revisit if.** Multiple app replicas were needed, or write concurrency
became the bottleneck.

---

## ADR-003 — Optimistic locking on a version column

**Decision.** Every post carries `version`. Mutations send `expectedVersion` and
update with `WHERE id = ? AND version = ?`. Zero affected rows means a conflict.

**Why.** Two editors on one article is the realistic failure, and last-write-wins
loses work silently — the worst kind of bug, because nobody notices for days.

**Why not pessimistic locking.** It needs a lock owner, a timeout and an answer
for the tab closed mid-edit. Conflicts here are rare enough that detecting them
beats preventing them.

**The detail that matters.** The version bump and the revision snapshot share one
transaction. If the snapshot fails, the update rolls back, so history can never
disagree with the current row.

**In the UI.** A conflict never discards typed text. The editor keeps the user's
input on screen, shows the current server version, and offers reload or compare.
An E2E test asserts exactly that.

---

## ADR-004 — Append-only revisions; restore writes forward

**Decision.** Every save snapshots the whole post into `post_revisions`.
Restoring an old revision copies its _content_ into a new version rather than
rewinding.

**Why.** History that can be rewritten is not history. Writing forward means the
trail of what happened — including the mistake and the recovery — stays intact.

**A deliberate subtlety.** Restore does **not** restore `status`, `publishedAt`
or `scheduledAt`. Bringing back an old body must never silently republish an
archived post or resurrect a stale publication date. Only content moves forward;
an integration test pins this.

**Cost.** Full-row snapshots use more space than diffs. For an editorial CMS the
simplicity is worth it; a size cap or diff-based storage would be the fix if it
ever mattered.

---

## ADR-005 — Opaque database-backed sessions, not JWTs

**Decision.** A random 32-byte token in an `HttpOnly` cookie. The database stores
only `HMAC-SHA256(SESSION_SECRET, token)`.

**Why.**

1. **Revocation is immediate.** Disabling a user or changing a password revokes
   live sessions in the same transaction. A stateless JWT cannot do that without
   a denylist — which is a session table with extra steps.
2. **A database leak is not a login.** Only hashes are stored, so stolen rows
   cannot be replayed without `SESSION_SECRET`.
3. **The token is opaque.** No claims to leak or to keep in sync.

**Cost.** One indexed lookup per authenticated request — irrelevant next to
in-process SQLite. `last_seen_at` is throttled to one write per five minutes so
reads stay read-mostly.

---

## ADR-006 — Timestamps as ISO 8601 UTC text

**Decision.** Store UTC ISO strings written by the application. SQL
`CURRENT_TIMESTAMP` defaults exist only as a safety net.

**Why.** SQLite has no date type, so something has to be chosen. ISO 8601 UTC
sorts lexicographically in the same order it sorts chronologically, which means
`published_at <= ?` works as a plain string comparison and indexes normally.

**The catch handled.** SQL `CURRENT_TIMESTAMP` produces `YYYY-MM-DD HH:MM:SS` —
UTC but with no zone designator, and it does _not_ sort correctly against ISO
strings with a `T`. `parseStoredDate()` normalises both forms, and every
application write goes through `nowIso()` so mixed formats never reach a
comparison.

**Display.** Rendered in the site-configured IANA timezone via `Intl`.

---

## ADR-007 — Markdown with raw HTML disabled

**Decision.** Content is Markdown, rendered with `react-markdown` + `remark-gfm`
and no `rehype-raw`. `dangerouslySetInnerHTML` appears nowhere.

**Why.** Stored XSS is the classic CMS vulnerability, and the cheapest defence is
to never have an HTML sink. Raw HTML in a post body is escaped and displayed as
text. There is nothing to sanitise because nothing is interpreted.

**Also.** Link and image URLs are re-validated at render time as well as at
write time, since content can predate a validation change.

**Cost.** Authors cannot embed arbitrary HTML. For this product that is a
feature.

---

## ADR-008 — Two tables for menus

**Decision.** `menus` (location) + `menu_items` (typed, nestable, ordered).

**Why.** The original brief's single `NavMenu(Id, Title, Position, url)` cannot
express more than one location, nesting, or a link that follows a post's slug
when it changes. A `url` column pointing at a post is a broken link waiting to
happen.

**How targets resolve.** `CUSTOM` stores a validated URL; `POST` and `CATEGORY`
store a foreign key and generate the URL from the current slug. A rename cannot
break the menu.

**Public filtering.** Items whose target is unpublished, archived, deleted or
inactive are dropped, along with their subtree. The admin builder shows _why_ an
item would be hidden rather than silently omitting it.

**Reordering.** One atomic `PUT /menus/:id/reorder` carrying every item.
Duplicates, missing items, foreign ids, cycles, excess depth and duplicate
sibling positions all reject the whole request. A partially applied order is
impossible.

---

## ADR-009 — Read counting with a hashed visitor cookie

**Decision.** An opaque random visitor cookie; only `HMAC-SHA256` of it is
stored, keyed by `(post_id, viewer_hash, viewed_on)` as the primary key.

**Why.** A raw counter measures refreshes, not readers. The composite primary key
makes de-duplication a database guarantee rather than application logic:
`INSERT OR IGNORE` either inserts or does not, and the counter increments only
when it did.

**Privacy.** No IP address is stored. The stored hash cannot be reversed to the
cookie without `VIEWER_HASH_SECRET`.

**Concurrency.** The insert and the increment run inside `BEGIN IMMEDIATE`, so
they cannot interleave with another writer. The increment is atomic SQL
(`reads_count = reads_count + 1`), never read-modify-write in memory.

**Honest scope.** This is refresh de-duplication, not analytics. No bot
filtering, no sessionisation.

---

## ADR-010 — Authorization in services, never in components

**Decision.** Every protected operation checks permission inside the service.
The UI calls the same predicates only to decide what to render.

**Why.** A hidden button is not a control. The tests call the API directly — an
author POSTing to `/posts/:id/publish` gets `403` whether or not a button exists.

**A specific choice.** Reading another author's draft returns `404`, not `403`.
`403` confirms the resource exists, which is an enumeration oracle. Missing and
forbidden look identical from outside.

---

## ADR-011 — Zod schemas generate the OpenAPI document

**Decision.** One set of Zod schemas drives request validation and, via
`z.toJSONSchema`, the OpenAPI components.

**Why.** Hand-written API docs drift from the implementation within weeks.
Deriving them from the validators means a contract change and a validation change
are the same edit.

**Why not `@hono/zod-openapi`.** It was the first choice and is in the
specification's dependency baseline, but its published types do not resolve
correctly under `moduleResolution: bundler` with Zod v4 — `.refine()` callbacks
degraded to `any` and broke `strict` typechecking. Since only `z` and route
metadata were needed, the wrapper was dropped in favour of plain Zod plus
`@hono/swagger-ui` for the interactive page. Same guarantee, one dependency less.

---

## ADR-012 — Bounded in-process rate limiting, plus a database-backed login throttle

**Decision.** Login failures are counted in a `login_attempts` table keyed by an
HMAC of (normalised email + client identifier). Uploads and view counting use an
in-process limiter with a hard cap on tracked keys.

**Why the split.** Login throttling must survive a restart, or an attacker just
waits for a deploy. Upload and view limits are about protecting the process right
now, so in-memory is sufficient and much cheaper.

**Honest limit.** The in-process limiter is per instance. With multiple replicas
it would need a shared store. Documented rather than pretended away — and this
deployment runs one instance by design (ADR-002).

---

## ADR-013 — FTS5 with a tested fallback

**Decision.** An FTS5 external-content table over `subject`, `excerpt` and
`content`, kept in sync by triggers. If the SQLite build lacks FTS5, the
migration is skipped and search falls back to parameterised `LIKE`.

**Tokenizer.** `porter unicode61 remove_diacritics 2` — stemming so "publishing"
matches "publish", and diacritic folding so "café" matches "cafe".

**Ranking.** `bm25()` weighted 10 / 4 / 1 across subject, excerpt and content,
with publication date breaking ties so results are deterministic.

**Safety.** Visitor input is never passed through as FTS syntax. Every token is
quoted and escaped, so `NEAR`, `*`, `"` and `-` are treated as literal text. A
malformed expression degrades to `LIKE` rather than returning a 500. Both paths
apply the same public-visibility predicate, so neither can leak a draft.

---

## ADR-014 — One `publicVisibility()` predicate

**Decision.** A single SQL predicate defines "publicly visible", composed into
every public query.

**Why.** The realistic leak is not a dramatic exploit; it is a new endpoint added
six months later that forgets one condition. With one definition, that mistake
requires deliberately not using it.

A post is public only when `status = 'PUBLISHED'` **and** `published_at <= now`
**and** `deleted_at IS NULL` **and** its category is active. Integration tests
assert every one of those independently.

---

## ADR-015 — E2E runs `next start`, Docker ships standalone

**Decision.** `next.config.ts` sets `output: 'standalone'` for the Docker image.
The Playwright harness runs the same production build through `next start`.

**Why.** The standalone bundle copies traced dependencies, and pnpm's symlinked
store makes that fail on Windows with `EPERM`. Rather than degrade the developer
experience or weaken the container, the two paths are separated: E2E validates
application behaviour, and CI's `docker` job builds the image and boots the
container against `/api/v1/health` to validate the standalone artifact.

**Result.** Both artifacts are exercised on every push, neither is assumed.
