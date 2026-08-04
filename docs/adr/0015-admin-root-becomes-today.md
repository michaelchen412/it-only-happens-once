# 0015 — `/admin` becomes Today; the Workshop moves to its own route

Status: **Accepted** *(2026-08-02 — the move shipped with it; see
[0012](0012-hq-is-a-private-second-domain.md) for the boundary it rests on)*
Date: 2026-07-31

## Context

`/admin` is currently the **Fragment Manager** — the sortable table over all
fragments, with filters, search, bulk actions and the Add ▾ menu
([admin.md](../admin.md) §2). It has been the admin's front door since the admin
existed, and a good deal of the app deep-links to it: the `#edit=<id>` and
`#new-writing` hashes, the 302 from the retired `/admin/writing/[id]`, the
`/admin/fragments-panel` partial, `PageHeader` back links, and the e2e tests.

HQ ([0012](0012-hq-is-a-private-second-domain.md)) adds three more rooms —
Today, People, Agenda — and one of them has a claim on the front door that the
Fragment Manager does not.

The claim rests on what Michael said the daily ritual is: *"When I log in for the
first time on a day to the admin side of my dashboard, I want to see a quick
summary, like today's summary, as that kind of landing page."* The check-in in
particular is designed to be the first thing seen on waking, and the whole HQ
thesis depends on there being a reason to open this every single morning. Writing
is frequent but not daily; Today is daily by construction.

There is also a structural argument. `/admin` is now the root of **four** rooms,
not the name of one screen. Leaving one room mounted at the root makes the other
three feel like annexes of the fragment table, which inverts the relationship —
the Workshop becomes a wing of HQ, not the other way round.

Against this sits a real cost: `/admin` is a shipped, working surface with a
year of muscle memory and a web of internal links pointing at it, and moving it
is pure churn that produces no new capability.

## Decision

**`/admin` becomes Today. The Fragment Manager moves to `/admin/fragments`.**

- **The sidebar already exists** ([`AdminLayout.astro`](../../src/layouts/AdminLayout.astro))
  — fixed on desktop, an off-canvas drawer on mobile, with four entries. This is
  therefore not "build a room switcher"; it is *add entries and change what
  `/admin` renders*. People and Agenda stay absent until 12 and 13 ship.
- **A hash never reaches the server, so the redirect cannot carry it.**
  `/admin#edit=<id>` and `/admin#new-writing` are load-bearing — they are where
  the retired `/admin/writing/[id]` 302 lands, where an unpublished post's
  "edit" link points, and what six e2e specs drive. A server-side 302 from
  `/admin` **silently drops the fragment identifier**. So the *producers* get
  updated (the 302, the blog `editHref`, `historyBase` in `admin-list.ts` and
  `fragment-panel.ts`, the specs), **plus** a small client-side bounce on Today
  for muscle memory and old links.
- **Today does not mount the writing sheet.** `WritingSheet` is imported by
  `/admin/index.astro` and the composer, *not* by the layout — so Today stays
  free of TipTap by default, which matters for a page opened every morning on a
  phone. The accepted cost is that `#new-writing` now belongs to
  `/admin/fragments`.
- **The manifest needs no change.** `start_url` is already `/admin`, so the
  installed app opens on Today for free.
- **Deep links are preserved, not broken.** `/admin#edit=<id>` and
  `/admin#new-writing` must keep working — they are the landing point of the
  retired writing-page 302 and are in muscle memory. Either redirect them to the
  new route with the hash intact, or keep honouring them at the root.
- The `/admin/fragments-panel` partial keeps its path; it is an implementation
  detail of the table, not a room.
- **Today ships as a shell first**, carrying the date bar plus an empty frame;
  the check-in, People and the agenda add cards to a page that already exists.
- **The rooms** stay plain — Today, Fragments, People, Agenda — per
  [admin.md](../admin.md) §1's rule that the private rooms optimise for speed
  and density over poetry. **The building** gets one name, the *Observatory*:
  the room a sky is watched from, whose defining activity is the patient
  repeated log where the value lives in the series rather than in any single
  night. It replaces *Workshop*, which after this change would be describing
  both the whole and one of its parts.

**A related departure, recorded here so it does not read as drift:** person
profiles are **full pages**, not overlays. [admin.md](../admin.md) §3.6
records the decision that everything edits in an overlay and the standalone
writing page was retired. That decision was about *editing context* — clicking an
essay while composing a constellation threw you out of the room. A profile has no
analogous host context: it is a reading destination navigated to on purpose, long
and multi-sectioned in a way a sheet would cramp. The overlay rule continues to
hold for fragment editing, unchanged.

## Consequences

- The daily ritual has a home, and the check-in is the first thing seen. This is
  the mechanism the whole of HQ depends on.
- **One migration of churn**, paid once: every link, redirect, back link, nav
  entry and e2e selector pointing at `/admin` as "the list" needs auditing. It
  was done as a piece of its own, verified alone, for exactly that reason.
- Michael's own habit changes: the muscle memory of "open the admin, see my
  fragments" breaks. Preserving the `#edit` hashes softens it; nothing removes it
  entirely.
- Today becomes a **hub with four contributors** (check-in, agenda, people,
  signals) and will accrete. It needs an owner for its card order and a rule
  against unbounded growth, or it becomes the cluttered dashboard the existing
  tools already are — the specific thing Michael said he wanted to escape.
- Every future admin surface must now answer "which room?", which is a useful
  forcing question.

## Alternatives

**Leave the Fragment Manager at `/admin`; put Today at `/admin/today`.** Zero
churn, all links intact. Rejected because the daily surface would sit one click
behind a surface used weekly, which inverts the frequency and quietly undermines
the habit HQ is built to create. The root is the highest-value real estate in the
app and should go to the thing opened most.

**A separate top-level route for HQ (`/hq`) beside `/admin`.** Clean separation,
and it splits the private half into two front doors — reproducing exactly the
"different apps, click in multiple places" complaint. Also doubles the middleware
and layout surface for no benefit, since both are gated identically.

**Today as a modal or a banner over the existing list.** Cheapest of all.
Rejected: Today is a real, growing surface with four contributors, and a modal
that appears on every load is the blocking wall HQ's *absence never accumulates*
principle explicitly forbids — on the mornings this page exists to serve, being
able to reach the day in one tap is the whole design constraint.
