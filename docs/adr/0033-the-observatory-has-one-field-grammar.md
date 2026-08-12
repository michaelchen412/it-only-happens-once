# 0033 — The Observatory has one field grammar

Status: **Accepted** *(2026-08-12 — decided at a bench, not on paper. The
register was chosen by looking; the ink was chosen by measuring. The CSS half is
in the tree; the markup half is named in Consequences and is not yet done.)*
Date: 2026-08-12

## Context

The admin grew two complete sets of form primitives covering the same jobs, and
**nobody ever decided that.** It is the order the files were written in: the
corpus workshop (plans 01–09) built on daisyUI, HQ (plans 10–14) built its own
primitives in `hq.css` because it was a new room with a new register, and nobody
ever argued that a task's label should be a different size from a quote's.

A read audit of the whole Observatory on 2026-08-11 (plan 38) found the split and
framed it as *two stylesheets* — `hq.css` versus `admin.css`. **Measured a day
later, that framing was wrong**, and the correction is what made the decision
tractable. The two *named* primitives are on the same side:

| | size | case | tracking | ink | uses |
|---|---|---|---|---|---|
| `.f__k` (HQ) | 10px | UPPER | .06em | 48% | 25 |
| `.admin-label` (workshop) | 11.2px | UPPER | .08em | 50% | 12 |
| an inline `<span>` (corpus sheets) | **14px** | sentence | — | 70% | 14 |
| `about.astro`'s `fieldLabel` const | 14px | sentence | — | 70% | 6 |

1.2px and 2% separate the first two. **The real divergence was never between the
two stylesheets — it was between the two named classes and the unnamed span the
corpus sheets copied from each other**, which is also how `about.astro` came to
declare a fourth system as a page-local `const`.

Two field grammars means every new form starts with a coin-flip, and the coin had
already been flipped four times.

### Why this was decided at a bench

The question — *which register is right?* — is not answerable from a diff, and
the repo has an idiom for that: [ADR 0030](0030-the-page-carries-the-masthead.md)
was decided at `/lab/chrome`, and the music room at `/lab/music`. So
`/lab/fields` rendered one form in four registers, one source, differences in CSS
keyed off a `data-fx` attribute — so the baseline column was not a *copy* of the
shipped `.f`, it *was* `.f` with the bench's stylesheet silent.

**And the bench measured what the eye should not be asked to judge.** A live
contrast readout, computed by compositing each label over the card's real ground:

| Register | dusk label | dusk hint | paper label | paper hint |
|---|---|---|---|---|
| `.f` (HQ) | 3.99 ✕ | 3.39 ✕ | **2.82 ✕** | **2.43 ✕** |
| `.admin-label` | 4.28 ✕ | 3.71 ✕ | 2.97 ✕ | 2.62 ✕ |
| corpus inline span | **7.26 ✓** | 3.71 ✕ | **5.38 ✓** | 2.62 ✕ |
| the decision (below) | 9.14 ✓ | 6.42 ✓ | 7.30 ✓ | 4.57 ✓ |

**Both named candidates failed WCAG AA in both themes**, and the one register
nobody had named — the corpus's copied span — was the only shipped thing that
passed. Every label here is under 18.66px, so none of them qualifies for the 3:1
large-text exemption.

The thresholds are not invented for this record. [Plan
19](../../docs/plans/19-one-chair.md) derived them by measurement — dusk crosses
4.5:1 at 55% opacity, paper not until 65% — which is why its ink ramp pairs steps
by the **ratio** they hit rather than by the opacity they share.

## Decision

**One field grammar for every admin form, in both halves of the building:**

| | |
|---|---|
| **Label** | `.f__k` — 11.2px, uppercase, .08em tracking, **80%** ink |
| **Hint** | `.f__h` — 12px, sentence case, **65%** ink |
| **Required** | `<em>required</em>` inside the label |
| **Input chrome** | daisyUI's `input input-sm input-bordered` |

**The register that won is the workshop's; the class name that won is HQ's.**
Michael picked `.admin-label`'s geometry with both on screen — *"Workshop —
.admin-label definitely the best option here"* — and `.f__k` carries 25 uses to
`.admin-label`'s 12, so the register is expressed in whichever name costs least
to keep. `.admin-label` is retired **into** that rule rather than beside it.

**The ink is not the register and was not put to the eye.** 80/65% is the floor
that clears 4.5:1 in dusk *and* paper; it was confirmed by looking only after it
was derived by measuring.

⚠ **This constrains geometry and ink. It does not touch:** sheet widths (they
track content — [ADR 0032](0032-a-sheet-is-dismissible-and-says-what-that-costs.md)),
CTA hues (`cn-amber` / `cn-azure` / `cn-gold` are a real domain axis that
`docs/admin.md` §1 argues for), or the sheet shell (plan 29 · §6 owns it).
**Only the geometry converges. Never the hue.**

## Alternatives

**Keep two registers — the two halves are genuinely two rooms.** The strongest
rejected argument, and one a competent person will make again: `.f` is a
phone-first grammar built for sheets used one-handed while standing up, the
corpus rooms are desk furniture, and `admin.md` §1 already runs a domain colour
axis — so let the grammars differ too. **It loses because a label's size is not a
domain signal.** The colour axis says which room you are in and keeps doing that
job; nothing was left for the type to say. And the cost was already visible in
the tree: two grammars is what produced a third (`about.astro`) and a fourth
(`SongSheet`'s copied spans), because a new form with two precedents has none.

**Migrate everything to the corpus's 14px sentence-case span.** This is the
option the numbers favoured — the only shipped register that passed AA. **It lost
on the look, judged side by side: it reads as a web form rather than as an
instrument.** Recorded plainly because a future session reading only the contrast
table would reach for it, and the answer is that its ink was right and its
register was not — so the ink came along and the register did not.

**Keep `.f`'s 10px/.06em and only raise the ink.** The cheapest possible change,
and it was on the bench as its own column. Rejected by eye against 11.2px/.08em.

**A whole `<Field>` component.** Not considered here and deliberately not
proposed. [ADR 0032](0032-a-sheet-is-dismissible-and-says-what-that-costs.md)
rejected a `<Sheet>` component on the grounds that it would need "a prop for
every difference"; a field wrapper has the same smell, and CSS classes already
carry this without inventing an API.

## Consequences

**All of it is done, 2026-08-12**, in two commits — the CSS (42 sites, no
markup) and then the migration (10 files). What the migration turned up, since
none of it was visible from the decision:

- ⚠ **`.admin-label` was TWO THINGS wearing one class, and only one was a field
  label.** Seven uses were fields (the composer, the constellations index,
  `ConstellationPicker`) and **five were section headings** — `<h2>` on
  `/admin/people` and `/admin/agenda/goals`, a `<summary>`, and two menu headings
  in the fragment manager's bulk bar. The seven converted; **the five did not**,
  and `.admin-label` survives as a heading-only class. **This is most of why it
  looked like a competing field primitive: half its uses were never fields.**
  ⚠ **It still needs a name and an ink** — at 50% it fails AA like everything
  else did, and "admin-label" now describes none of what it does. Open.
- ⚠ **There was a FIFTH register, not four.** `PublishDialog` labels at
  `text-base-content/80` where the other corpus sheets use `/70`. Nobody counted
  it because nobody was looking at that dialog.
- ⚠ **The corpus half fused its hints INTO its labels**, and the migration is
  what made the reason obvious: it had no hint primitive, so eight labels carry a
  parenthetical — *"Source link — optional"*, *"Added — the year it entered the
  corpus"*. Uppercasing those produces long uppercase runs, which is the one
  thing uppercase micro-type is worst at. **`.f__k span` was added for them**: a
  qualifier that opts out of the uppercase and sits at the 65% floor, sentence
  case, subordinate. Not `.f__h`, which renders *below* the control — "optional"
  is something you need while your eye is still on the label.
  ⚠ **This is also the one defect the migration shipped and had to fix by
  looking**: `about.astro`'s parentheticals were bare text rather than spans, so
  the first pass rendered `PHOTO CAPTION (OPTIONAL — A PLACE, A DATE, A MOMENT)`.
  Green checks throughout; caught by a screenshot.
- **`.f input`'s padding moved to daisyUI's `input-sm` metrics** (`0.375rem
  0.625rem` → `0.3125rem 0.75rem`), because that is the chrome the approved
  column was shown in. The daisyUI classes came **off** the migrated fields
  rather than being layered over `.f` — two systems styling one `<input>` is how
  you get a border that answers to whichever stylesheet loaded last.

**Deliberately still out of scope:**

- **`.admin-hint` stays.** 71 uses across 29 files, most of them general small
  print rather than field hints, and at 45% it fails AA everywhere. That is
  [plan 19 · Piece 5](../../docs/plans/19-one-chair.md)'s ink ramp, not this
  decision.

**What would falsify this.** If a form appears whose labels genuinely need to be
read rather than glanced — a long questionnaire, something a second person fills
in — then an 11.2px uppercase key is the wrong instrument and this record should
be revisited rather than worked around. Nothing in the Observatory is that today;
every one of its forms is filled by the person who designed it.
