# 0024 — The zoom is navigation, and the overview is home

Status: **Accepted** *(2026-08-10 — written late, from `design.md` §13 and
plan 18 (`docs/plans/archive/18-sky-return.md`). The decision itself was taken 2026-07-23
on the dev-only `/sky-lab` bench, amended in 2026-07 by a reversal, and has
governed every Sky change since; it is Accepted rather than Proposed because
what it records has been load-bearing for a year.)*
Date: 2026-08-10 *(the lateness is the reason it exists — see Context.)*

## Context

**This decision has been binding since 2026-07 and has never been in this
repository.** That is the whole reason for writing it, and it is worth stating
plainly before the argument, because the argument itself is not new.

The Sky's navigation model lives in `design.md` §13. `design.md` is **git-ignored
on purpose** — it is a personal working file, and it should stay one. But §13 is
not only visual design: it settles how the site's central surface is *routed*,
and later work has treated it as precedent. Plan 18 (`docs/plans/archive/18-sky-return.md`)
rejected an entire alternative architecture by quoting it:

> **"The zoom is navigation, and home IS the overview."** … **"`/{slug}` is
> canonical and shareable."**

and the amendment recording that a different model had already been tried:

> *"Amended 2026-07: 'land inside a constellation' with a cycling 'tonight' door
> was built, felt, and reversed — landing mid-suite disoriented; the overview
> teaches with the map in hand."*

So a reader could work through all 22 preceding ADRs and still not learn why the
Sky navigates the way it does — or that the obvious alternative had been built
and reversed at cost. That is the gap plan 35 (`docs/plans/35-the-decision-has-one-home.md`)
was written to close, and this is the case that proved it: **an argument good
enough to kill an architecture is good enough to be in the repository.**

⚠ **The source is quoted rather than linked**, which no other ADR here needs to
do. Linking `design.md` from a published document would point a reader at a file
that does not exist in the repository they are reading — the exact failure
plan 28 (`docs/plans/archive/28-docs-catch-up.md`) spent seven sections repairing.
The quotes above are the load-bearing sentences; `design.md` keeps the rest.

### What forced it to be written down twice

The reversal is the part nobody can reconstruct. **Landing inside a
constellation was built.** It had a cycling "tonight" door — arrive somewhere
specific, in medias res. It was felt, and it was reversed: landing mid-suite
disoriented, because the reader had no map. The overview teaches *with the map
in hand*, and the zoom is what makes the map worth having.

Plan 18 then met the question from the other side. A real bug — the
constellation name "flies up and stops" on the way back — invited an obvious
fix: keep the overview mounted and expand the suite in place, an overlay or an
accordion. That would make the snap *structurally impossible*, which is
genuinely attractive. It is also the same reversal in different clothes.

## Decision

**The zoom between the overview and a constellation is a real navigation, not a
disclosure. `/` is home and `/{slug}` is a place you can send someone.**

1. **`/` is the whole sky** — the weighted list, every constellation's name over
   its description. It is the site's front door and the thing a reader returns
   to.
2. **`/{slug}` is canonical and shareable.** A constellation has an address. This
   is the constraint everything else here is downstream of, and it is not
   negotiable for a site whose premise is that a constellation is a way of seeing
   **you can hand to someone**.
3. **The name is the shared element.** `transition:name` on the constellation's
   name morphs it between the overview and the landing header, so the zoom
   carries name *and* meaning rather than cutting.
4. **Returning is remember-and-restore, never keep-mounted.** Going back is a
   forward navigation to `/`, with the overview's scroll position restored to the
   constellation you came from *before the transition resolves* — see
   `src/scripts/sky-slot.ts`, which stores the **slug** rather than a pixel
   offset precisely because the overview reflows when a constellation is
   published, renamed, reordered or recoloured.
5. **A suite always resolves upward.** The outro is a single invitation — *all
   constellations* — never a sideways hop to a neighbour. Every way out (the name
   itself, the ✦ beside it, the floating ✦ at depth, Escape) goes home.

## Consequences

- **The morph's correctness depends on the restore, and the coupling is not
  obvious.** `sky-slot.ts` opens by saying so: delete it as "just a scroll
  thing" and the reverse zoom silently un-fixes itself, because the morph
  animates toward wherever the element *lands* in the new page. One cause, two
  symptoms.
- **There is no network pause to design around, and no prefetch config to add.**
  Astro's `<ClientRouter />` prefetches with `prefetchAll: true` by default and
  the suite's return links point at `/`, so `/` is already warm before the click.
  Verified in plan 18 against Astro's own documentation. **Do not add prefetch
  configuration** on the belief that this needs it.
- **A second renderer for the suite is permanently off the table.** In-place
  expansion would require one — or the loss of canonical URLs — and keeping two
  renderings of a composed suite in step forever is a cost with no end date.
- **Scroll restoration is now a thing that can break**, and nothing in the e2e
  suite watched it until `tests/e2e/sky-return.anon.spec.ts` (13 specs) existed.
- **This constrains every future Sky change.** Any proposal that dissolves
  `/{slug}` — an overlay, an accordion, a modal suite, infinite scroll through
  constellations — is arguing with this ADR and should say so.

## Alternatives

**Keep the overview rendered and expand the suite in place** (overlay or
accordion). The strongest alternative, and the reason it loses is not
aesthetics: it costs either the canonical shareable URL, or a second suite
renderer kept in step forever. Plan 18's own summary — *"that's a large
architectural change to solve a positioning bug"* — and the positioning bug had
a small fix. **The seamlessness does not require it: nothing about a page
navigation forces a snap; the snap was there because the destination was wrong.**

**Land inside a constellation, with a cycling "tonight" door.** Not theory —
**built, felt, and reversed in 2026-07**. Landing mid-suite disoriented; the
overview teaches with the map in hand. This is the alternative most likely to be
re-proposed, because arriving somewhere specific always sounds better than
arriving at a list.

**Store `scrollY` rather than the slug** for the return. Simpler and quietly
wrong: the overview reflows whenever a constellation is published, renamed,
reordered or recoloured — and the admin index can now drag the sky into a new
order, so this is routine rather than hypothetical. A remembered offset would
restore you to the *wrong* constellation and read as a bug in the morph.

**A scattered star-field for the overview**, instead of the weighted list.
Prototyped on `/sky-lab` and rejected as too messy — recorded here because it is
the first thing anyone imagines when they hear "sky", and it has already been
tried.

## Scope

⚠ **This ADR takes `design.md` §13's *navigation model* and deliberately leaves
the rest of it.** §13 also carries the typeset registers (a quote set whole, an
essay as title-plus-fading-excerpt, a song leading with Michael's words), the
drawn arcs, the passing lamplight, and the eight-slot colour ramp. Those are
visual-design decisions with a living home in `design.md`, and an ADR that
absorbed them would become a second copy of that file — which is the drift plan
35 exists to stop, arriving from the other direction.

The line is: **what constrains routing and architecture is here; what constrains
appearance stays there.** [ADR-0022](0022-the-sky-affords-differently-on-a-thumb.md)
already took the one appearance question that had become architectural, and it
is the neighbour to read next.
