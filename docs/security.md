# Security

What is implemented, why, and where the limits are.

---

## Passwords

Argon2id with the current OWASP baseline: 19 MiB memory, 2 iterations,
parallelism 1.

Argon2id is chosen over bcrypt for memory-hardness — it makes GPU and ASIC
cracking substantially more expensive. The parameters sit at the baseline rather
than higher so CI on a shared runner stays fast; on dedicated hardware, raising
`memoryCost` is the first thing to do.

**Policy.** A 12-character minimum plus a check against the most common leaked
passwords. Deliberately no composition rules — demanding an uppercase, a digit
and a symbol reliably produces `Password1!`, which is worse than a long
passphrase.

**Handling.** Hashes are never returned by any endpoint, never logged, and the
logger redacts anything keyed `password`, `passwordHash` or similar. Integration
tests assert no response body ever matches `/\$argon2/`.

**Account enumeration.** Unknown email, wrong password and disabled account all
return the same code and the same message. The unknown-account path still runs a
real Argon2 verification against a throwaway hash, so response time does not
reveal whether the account exists.

---

## Sessions

A 32-byte random token in an `HttpOnly` cookie. The database stores only
`HMAC-SHA256(SESSION_SECRET, token)`.

**Why hash it.** Stolen database rows cannot be replayed as logins without also
holding `SESSION_SECRET`, which lives in the environment rather than the database.

**Cookie flags.**

| Flag       | Value                          | Reason                                                          |
| ---------- | ------------------------------ | --------------------------------------------------------------- |
| `HttpOnly` | always                         | JavaScript cannot read the token, so XSS cannot exfiltrate it   |
| `SameSite` | `Lax`                          | Blocks cross-site POSTs while keeping normal navigation working |
| `Secure`   | production over HTTPS          | Never sent in the clear                                         |
| `Path`     | `/`                            | Required by the `__Host-` prefix                                |
| name       | `__Host-pf_session` over HTTPS | A sibling subdomain cannot overwrite it                         |

**Rotation.** A fresh token is issued on login and again after a password change,
so session fixation has nothing to fix on to.

**Revocation.** Immediate, and transactional:

- disabling a user revokes their sessions in the same transaction;
- changing a password revokes every session and issues a replacement for the
  current device only;
- an admin password reset revokes all of the target's sessions.

Integration tests verify each of these by confirming a previously working client
starts getting `401`.

`last_seen_at` is throttled to one write per five minutes so an authenticated
read stays a read.

---

## CSRF

Three independent layers, all required for a cookie-authenticated mutation:

1. **Origin allow-list.** `Origin` must match `APP_URL` or the request `Host`.
2. **`Sec-Fetch-Site`.** Rejected when the browser reports `cross-site`.
3. **Signed, session-bound double-submit token.** Format
   `<nonce>.<HMAC(CSRF_SECRET, nonce + "." + sessionTokenHash)>`, sent in both the
   readable `pf_csrf` cookie and the `X-CSRF-Token` header. Both must match, and
   the signature must verify against _this_ session.

Binding the signature to the session token hash is what stops a token minted for
one session being replayed against another — there is an explicit test for that.
Comparisons are constant-time.

Requests with no session skip the check: there is no ambient authority to abuse,
which keeps API clients and the internal job endpoint working without CORS.

CORS is deliberately **not** enabled. This is a same-origin application.

---

## Authorization

Enforced in the service layer, on every protected operation, without exception.
The UI calls the same pure predicates from `src/lib/permissions.ts` only to
decide what to render.

The tests reflect that: an author POSTing directly to `/posts/:id/publish` gets
`403` regardless of what the UI shows.

**Reading another author's draft returns `404`, not `403`.** A `403` confirms the
resource exists and turns the endpoint into an enumeration oracle. Missing and
forbidden are indistinguishable from outside.

**The last-administrator safeguard** is checked inside the same transaction as
the update, so two concurrent demotions cannot both succeed and lock everyone out.

---

## Content and XSS

Post content is Markdown, rendered with `react-markdown` + `remark-gfm` and
**no** `rehype-raw`. `dangerouslySetInnerHTML` appears nowhere in the codebase.

Raw HTML in a post body is escaped and shown as text. There is nothing to
sanitise because nothing is interpreted — a stronger position than sanitising,
which is a denylist that has to keep winning.

**URLs are validated twice**, at write time and again at render time, because
stored content can predate a validation change. `javascript:`, `data:`,
`vbscript:` and `file:` are rejected, as are attempts to smuggle a scheme past
the parser with control characters or whitespace (`java\nscript:`). Protocol-
relative (`//evil.com`) and backslash (`/\evil.com`) escapes are rejected for
internal paths.

External links get `rel="noopener noreferrer nofollow"`.

Unit tests assert a `<script>` tag in post content neither executes nor reaches
the DOM.

---

## File uploads

The most attacker-facing surface, so nothing the client says is trusted.

1. **Size is capped before the body is read** — `Content-Length` is checked
   first, and the parsed file is checked again.
2. **The real type comes from magic bytes** (`file-type`), not the declared
   `Content-Type` or the extension.
3. **The image must decode.** `sharp` parses it, which rejects a file that merely
   starts with the right bytes.
4. **It is re-encoded.** This strips EXIF and anything appended after the image
   data, so a polyglot cannot survive the round trip. Orientation is normalised.
5. **The storage key is generated** — `YYYY-MM-<32 hex>.<ext>`. The original
   filename is kept only as a sanitised display label. Path traversal has nothing
   to traverse, and the resolved path is verified to stay inside the upload
   directory anyway.
6. **Files live outside the source tree** and are streamed through a route, never
   served as application code.
7. **The database row is written after the file** — if the insert fails, the
   orphaned file is removed.

**Allow-list:** JPEG, PNG, WebP. **SVG is rejected** — it is XML, it can carry
script, and serving it from your own origin turns it into stored XSS.

**Serving.** `/api/v1/media/:id/file` requires a session.
`/api/v1/public/media/:id/file` serves an asset only when it is the site logo or
the featured image of a currently visible published post. Both send `nosniff`.

Tested: spoofed extension, wrong magic bytes, oversized file, unsupported type,
SVG, a PHP payload named `.png`, and a filename containing `../`.

---

## SQL injection

All queries go through Drizzle's parameter binding. There is no string
concatenation of user input into SQL.

The one place user input could influence SQL _structure_ — sort fields — resolves
through an explicit allow-list, so a value like `id; DROP TABLE posts` simply
falls back to the default. A unit test covers exactly that input.

FTS5 queries are the other risk, since MATCH takes an expression language.
Visitor input is tokenised, each token is quoted and internal quotes doubled, so
`NEAR`, `*`, `"` and `-` are literal text. A malformed expression falls back to
`LIKE` rather than erroring.

---

## Rate limiting

| Surface                    | Limit                | Storage    |
| -------------------------- | -------------------- | ---------- |
| Login (per email + client) | 10 failures / 15 min | Database   |
| Login (per client)         | 20 requests / min    | In process |
| Media upload               | 30 / min             | In process |
| View counting              | 120 / min            | In process |

Login throttling is database-backed so it survives a restart — otherwise an
attacker just waits for a deploy. The others protect the running process and are
in memory, with a hard cap on tracked keys so the limiter cannot itself become a
memory leak.

**Limit.** The in-process limiter is per instance. Multiple replicas would need a
shared store; this deployment runs one instance by design.

---

## Errors and logging

Domain errors map to stable codes. Everything else is logged server-side with its
request id and returned as a generic `500`. Stack traces, SQL text and driver
messages never reach a client — asserted by a test.

Each request gets an id, echoed as `X-Request-Id`. An inbound id is honoured only
if it matches `^[A-Za-z0-9_-]{8,64}$`; anything else is replaced rather than
echoed, so an attacker cannot inject content into the logs.

Access logs record method, **route template** (not the concrete URL), status,
latency and user id. Never logged: passwords, hashes, session cookies, CSRF
tokens, job secrets, uploaded bytes, or post content.

---

## Security headers

Set by both `next.config.ts` (pages) and Hono's `secureHeaders` (API):

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- `Cross-Origin-Resource-Policy: same-origin` (API)
- A restrictive CSP on API responses (`default-src 'none'`) — it returns JSON and
  image bytes, so nothing there should ever be treated as a document.

---

## Secrets

Loaded from the environment and validated at startup. Production refuses to start
if `SESSION_SECRET`, `CSRF_SECRET`, `VIEWER_HASH_SECRET` or `SCHEDULE_JOB_SECRET`
still holds the `.env.example` placeholder or is shorter than 32 characters. The
container entrypoint checks the same things before the server boots.

`.env` is gitignored. Only `NEXT_PUBLIC_`-prefixed variables can reach the
client, and this project defines none.

---

## Privacy

No IP addresses are stored anywhere. Read counting uses an opaque random visitor
cookie, and only its HMAC is persisted. The audit log records an actor id and
action metadata, never request bodies or content.

---

## Known limitations

Stated plainly rather than left to be discovered:

1. **In-process rate limiting does not span replicas.** Fine for one instance;
   would need Redis or a database table to scale out.
2. **No password reset flow.** There is no email service in scope. An
   administrator resets passwords, which revokes the target's sessions.
3. **No 2FA.** A clear next step for a production deployment.
4. **No account lockout.** Throttling only. Lockout is a denial-of-service vector
   if an attacker knows an email address.
5. **Uploads are not virus-scanned.** Type validation and re-encoding cover the
   web-facing risks; a ClamAV pass would be the addition for untrusted uploaders.
6. **No Content-Security-Policy on HTML pages.** Next.js inline bootstrap scripts
   need either a nonce or per-response hashing to do this properly, which was out
   of scope. The API responses do carry a strict CSP.
7. **SQLite is not encrypted at rest.** Use disk encryption, or SQLCipher.
