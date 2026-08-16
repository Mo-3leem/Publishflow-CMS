# PublishFlow — UI/UX Upgrade Report

Branch: `deploy/render`. Frontend-only pass over the public website and the admin
dashboard. Every claim below was checked in a real browser at 390 / 768 / 1024 /
1440 px, not inferred from a successful compile.

---

## 1. Scope, and what was deliberately not touched

17 files changed, +915 / −386. All of them are presentation:

```
src/app/(public)/*          src/components/public/*
src/app/admin/(protected)/  src/components/admin/*
src/app/globals.css         src/components/ui/*
```

Nothing under `src/server/`, `src/lib/`, or `drizzle/` was modified. Concretely,
these were left exactly as they were:

- Hono routes and handlers under `/api/v1`
- database schema, migrations, seed
- RBAC and permission checks
- the editorial workflow state machine
- revisions and restore
- optimistic locking (`expectedVersion` → `409`)
- rate limiting, validation, session and CSRF handling

No frontend integration fix turned out to be necessary, so the "unless absolutely
required" escape hatch went unused. No fake posts, statistics, images or
placeholder data were introduced — every screen renders real seeded content.

---

## 2. Design tokens

Added to `src/app/globals.css` so that radii, elevation and measure stop being
re-decided per component:

| Token              | Value                  | Purpose                |
| ------------------ | ---------------------- | ---------------------- |
| `--radius-control` | `0.5rem`               | buttons, inputs, chips |
| `--radius-surface` | `0.75rem`              | cards, dialogs, panels |
| `--shadow-raised`  | two-layer, 4–6 % alpha | resting elevation      |
| `--shadow-overlay` | two-layer, long throw  | dialogs and dropdowns  |
| `--measure-prose`  | `40rem`                | article reading column |

Verified on a live article at 1440 px: body text renders at 17 px with a 624 px
column and 29.75 px line-height — **≈73 characters per line**, inside the 60–75
target.

---

## 3. Public website

The strongest changes, as asked.

- **Homepage** rebuilt: masthead with the site name as `h1`, a real
  `<form method="GET" action="/search" role="search">` inline, a "Browse by
  topic" nav with live per-category counts, a featured lead article on page 1
  only, then a "More articles" grid.
- **Post cards** rewritten with a stretched-link pattern — an `aria-hidden`
  absolutely-positioned span inside the title link — so the whole card is
  clickable without nesting anchors inside anchors. Both the featured and grid
  variants render correctly with no image.
- **Article page**: excerpt promoted to a standfirst rather than a quote-styled
  block, metadata on a single ruled line, figure captions, source link marked as
  opening in a new tab.
- **Header/footer**: sticky backdrop-blur header; four-column footer whose Topics
  column is driven by `listPublicCategories()` and whose More column comes from
  the footer menu.
- **Navigation** now answers "where am I?" — `usePathname()` drives an underline
  active marker, and `branchIsActive()` lights the parent when a child is
  current. Search is a labelled control, not a bare icon.

---

## 4. Admin dashboard

Improved in place; not rebuilt.

- **Post list** is two presentations of one array. Below `xl`, a stacked card per
  post with `<dl>` labelled pairs so no column meaning is lost; at `xl` and above,
  the full sortable table. Both share one `RowActions` component, so behaviour is
  identical across breakpoints.
- **Workflow actions** gained `nextStepHint(status, actions)`, which states in
  plain language what the current status means and what happens next. The primary
  action is full-width; secondary actions sit in a row beneath it.
- **Markdown editor** toolbar buttons went from a 28 px to a 32 px target and
  picked up the app-standard focus ring, which they previously lacked.
- **Form fields** now mark required inputs with the word "Required" instead of an
  asterisk. It sits outside `<label>` deliberately: inside, the accessible name
  would become "Password Required".

---

## 5. Two real bugs found by inspecting rather than compiling

**Horizontal overflow across every admin screen at 768 px.** Tailwind's
`.sr-only` is `position: absolute`, and an `.overflow-x-auto` element that is not
itself positioned is not the containing block for absolutely positioned
descendants — so it does not clip them. The sort-hint spans inside the table
header were escaping their scroller and widening the page. Fixed globally:

```css
@layer utilities {
  .overflow-x-auto {
    position: relative;
  }
}
```

**The posts table was unusable at 1024 px.** Measured live: the table needed
1266 px inside a 719 px container, because the admin sidebar takes ~290 px. Half
the columns, including row actions, sat behind a horizontal scrollbar. The card
switch moved from `lg` to `xl` and cell padding was trimmed; at 1440 px the table
now measures 1135 px in a 1135 px container — an exact fit, no scroll.

---

## 6. Heading hierarchy

Three outline breaks were found and fixed:

- the homepage went `h1 → h3 → h2`; the featured card was promoted to `h2`
- `/search` and `/categories/[slug]` skipped `h1 → h3`; both received an
  `sr-only` `h2` section label with `aria-labelledby` on the wrapping `<section>`

Verified on `/categories/engineering` and on a live article: `h1 → h2 → h3 →`
footer `h2`s, with no level skipped.

---

## 7. The Request Changes focus fix is intact

This was the highest-risk thing to preserve, so it was confirmed two ways.

The root-cause fix in `src/components/ui/dialog.tsx` is untouched in substance —
`onClose` is read through `onCloseRef` so the focus effect depends on `open`
alone and cannot re-run per keystroke:

```tsx
const onCloseRef = React.useRef(onClose);
React.useEffect(() => {
  onCloseRef.current = onClose;
});
React.useEffect(() => {
  if (!open) return;
  /* … Escape handler calls onCloseRef.current() … */
  // `open` only — see the onCloseRef note above.
}, [open]);
```

Live in the browser, typing 40 characters into the review note:

```
{"activeTag":"TEXTAREA","activeIsTheTextarea":true,
 "value":"Please add a source link to section two.","valueLen":40,"selStart":40}
```

All 40 characters landed, focus was retained, the caret sat at position 40. The
E2E regression test `request-changes: the review note keeps focus through
continuous typing` also passes.

Focus management was checked end to end: opening the dialog moves focus inside
it, Escape closes it, and focus returns to the triggering button
(`focusBackOnTrigger: true`).

---

## 8. Responsive verification

No page scrolls horizontally at any tested width. Measured as
`document.documentElement.scrollWidth` versus `innerWidth`, plus an element sweep
for anything whose right edge exceeds the viewport.

| Screen                 | 390                                    | 768               | 1024                | 1440              |
| ---------------------- | -------------------------------------- | ----------------- | ------------------- | ----------------- |
| Homepage               | clean                                  | clean             | clean (1009 ≤ 1024) | clean             |
| Article                | clean (390)                            | clean             | clean               | clean, 73 ch/line |
| Search / category      | clean                                  | clean             | clean               | clean             |
| Admin dashboard        | clean                                  | clean             | clean               | clean             |
| Admin posts            | clean, cards                           | clean, cards      | clean, cards        | clean, table fits |
| Post editor            | clean                                  | clean (753 ≤ 768) | clean               | clean             |
| Media library          | clean (390)                            | clean             | clean               | clean             |
| Request Changes dialog | bottom sheet, buttons stack full-width | —                 | —                   | centred           |

At 390 the dialog becomes a bottom sheet spanning the full width, with its
actions stacked at 40 px each and `flex-col-reverse` keeping the primary action
nearest the thumb.

---

## 9. Accessibility

Preserved and, in a few places, improved:

- every form control has a real `<label for>` bound to an existing element —
  verified by walking all nine editor labels and resolving each `htmlFor`
- errors carry `aria-invalid` + `aria-describedby`, and pair an icon with colour
  so the signal is not colour alone
- all media library images have `alt` (0 missing of 3)
- the dialog is `role="dialog" aria-modal="true"` with a Tab trap, labelled by
  its title and described by its description
- sortable headers expose `aria-sort` and an `sr-only` hint stating the current
  direction and what activation will do
- touch targets: 44 px in mobile navigation, 40 px dialog actions, 32 px editor
  toolbar (past the 24 px WCAG 2.2 AA minimum)
- one focus treatment across every control, offset so it stays legible on both
  white and tinted backgrounds

---

## 10. Gate results

Run in full after the final edits:

| Gate                | Result                                               |
| ------------------- | ---------------------------------------------------- |
| `pnpm format:check` | pass — all files match Prettier                      |
| `pnpm lint`         | pass — 0 errors, 0 warnings (`--max-warnings=0`)     |
| `pnpm typecheck`    | pass — 0 errors, strict + `noUncheckedIndexedAccess` |
| `pnpm test`         | pass — 266 tests, 11 files                           |
| `pnpm build`        | pass — compiled in 1.5 s                             |
| `pnpm test:e2e`     | pass — 14/14 Playwright tests                        |

### Known limitations

- The admin posts table genuinely needs ~1135 px of content width. Between 1024
  and 1280 px the card list is shown instead; that is a deliberate trade, not a
  fitted table.
- Screenshots could not be captured in this environment (the browser pane was not
  compositing), so all visual verification above is measurement- and
  DOM-based — geometry, computed styles, accessibility tree — rather than
  pixel inspection.
- The `deploy/render` demo caveat is unchanged: Render Free has an ephemeral
  filesystem, so database and uploads reset on restart or redeploy.
