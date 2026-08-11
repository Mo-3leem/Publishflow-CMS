# Demo script

A five-minute walkthrough that shows the product decisions, not just CRUD.

## Before you start

```bash
pnpm install
cp .env.example .env
pnpm db:reset && pnpm db:migrate && pnpm db:seed
pnpm dev
```

Open two browser windows — one normal, one private. You will need both for the
conflict demonstration.

Accounts (development only, passwords from `.env`):

| Role   | Email                      |
| ------ | -------------------------- |
| Admin  | `admin@publishflow.local`  |
| Editor | `editor@publishflow.local` |
| Author | `author@publishflow.local` |

---

## 1. The public site (30s)

Open <http://localhost:3000>.

- Header and footer navigation come from the database, not from hard-coded links.
- Two published articles are visible. The seed also contains a draft, an
  in-review post, a scheduled post and an archived one — **none of them appear
  here.**

> "Everything on this page is filtered by one predicate. There is exactly one
> definition of 'publicly visible', so a new endpoint can't accidentally leak a
> draft."

---

## 2. An author cannot publish (60s)

Sign in at `/admin` as **author**.

- The sidebar shows no Users, Settings or Audit log.
- Create a post: **New post** → subject "Demo article" → some Markdown → **Create draft**.
- Note the version indicator: **Version 1**.

Open the slug in the private window: `/posts/demo-article` → **404**.

Click **Submit for review**. The status becomes _In review_ and a banner explains
the post is now read-only for its author.

> "Hiding the publish button isn't the control. The check is in the service."

Prove it — in the browser console:

```js
await fetch('/api/v1/posts/<id>/publish', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-CSRF-Token': document.cookie.match(/pf_csrf=([^;]*)/)[1],
  },
  body: JSON.stringify({ expectedVersion: 2 }),
}).then((r) => r.status);
// 403
```

---

## 3. Review and publish (45s)

Sign out, sign in as **editor**, open the review queue (**Posts → Review queue**).

- Open the post, click **Request changes**, enter a note. The comment is
  mandatory — try submitting an empty one first.
- The post returns to _Draft_ and the note appears in the workflow history.

Sign in as **author**, revise, resubmit. As **editor**, click **Publish**.

Refresh the public page — the article is live.

---

## 4. The conflict (60s) — the centrepiece

Open the same post in **both** windows as two different signed-in users. Both
show _Version N_.

- Window A: change the content, **Save changes**. It becomes version N+1.
- Window B (still on version N): type something different, **Save changes**.

Window B shows a red panel:

> This post was changed by someone else. Your copy is version N; the server now
> has version N+1. Nothing was overwritten.
> **Your unsaved text is still on this page — copy anything you need before reloading.**

**Point at the textarea.** The typed text is still there.

> "Last-write-wins would have silently destroyed window A's edit. Nobody would
> notice for days. Here it's a 409, the data is intact, and the user hasn't lost
> a keystroke."

---

## 5. Revision history (45s)

**Revisions** from the editor.

- Every save is listed with its version, author, date and change summary.
- Select two versions → **Compare** → a line-by-line diff, with `+`/`-` markers
  so it reads without relying on colour.
- **Restore** an older version → confirm.

Note the new version number.

> "Restoring writes the old content _forward_ as a new version. Nothing in the
> history is rewritten. And it restores content only — it does not republish an
> archived post or resurrect an old publication date."

---

## 6. Menus and settings (45s)

As **admin** → **Menus**.

- Move an item with the arrow buttons — keyboard-accessible, not drag-only.
- The banner notes the order is unsaved. **Save order** applies it in one atomic
  request; an invalid tree rejects the whole thing rather than half-applying it.
- Refresh the public site: the header order has changed.

**Settings** → change the site name → save → refresh the public site.

Back in **Menus**, point at any item marked with a warning:

> "That item links to a post that isn't published. It stays configured here, but
> it's dropped from the public menu — no dead links."

---

## 7. Read counting (30s)

Open a published post in the private window and refresh three or four times.
The read count shows **1**.

Open it in a different browser (or another private window): **2**.

> "Per browser, per post, per UTC day. The composite primary key makes it a
> database guarantee, not application logic. And no IP address is stored — the
> visitor cookie is random and only its HMAC is persisted."

---

## 8. Audit log (20s)

**Audit log** as admin. Filter by action.

> "Who published what, who changed a role, who reset a password. Append-only.
> Metadata renders as escaped key/value text, never as HTML."

---

## 9. The engineering (60s)

```bash
pnpm test        # 248 unit + integration
pnpm test:e2e    # 12 Playwright flows
```

Worth showing:

- `tests/unit/workflow.test.ts` — every transition, allowed and forbidden.
- `tests/integration/posts.test.ts` — the conflict test asserts the revision
  count is _unchanged_ after a failed save.
- `tests/integration/admin-resources.test.ts` — uploads rejected for spoofed
  extensions, wrong magic bytes, oversized files and SVG.
- `/api/v1/docs` — OpenAPI generated from the same Zod schemas used to validate.

Finally:

```bash
pnpm db:check
```

`PRAGMA quick_check`, `foreign_key_check`, and the application invariants — every
post has a revision, `reads_count` matches `post_views`, an active admin exists.

---

## Questions to expect

**"Why SQLite?"** Right for a read-heavy CMS on one instance — real transactions,
constraints, FTS5, no ops. One writer at a time is the limit; PostgreSQL is the
migration target and Drizzle keeps most queries portable.

**"What if revision creation fails after the post update?"** It can't be
observed — they share one transaction. If the snapshot throws, the update rolls
back.

**"How would scheduled publishing run in production?"** It already does:
`pnpm jobs:publish-scheduled` or `POST /api/v1/internal/jobs/publish-scheduled`
behind a bearer secret. The Compose stack runs a sidecar calling it every minute.
It is idempotent — a second run publishes nothing.

**"What would you cut under deadline pressure?"** The audit log UI (keep the
writes), the diff view (keep preview and restore), and the media library
(keep upload). Never the workflow, the locking or the tests.
