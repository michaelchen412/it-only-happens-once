# 0022 — The Sky affords differently on a thumb

Status: **Proposed** *(2026-08-10. The change shipped 2026-08-07 and has been
driven on a desktop; this records why, per this repo's pattern that an ADR is
written when the decision is made. It becomes **Accepted** once the touch model
has been walked on real hardware — see the ⚠ in Consequences, which is exactly
the check no green suite can stand in for.)*
Date: 2026-08-10 *(written late, and the lateness is the reason it exists — see
Consequences. The decision itself was taken 2026-08-07 on `/afford-lab`, a
dev-gated bench that carried the argument in a file comment until this ADR
took it over.)*

## Context

**Michael, 2026-08-06, after browsing the live site as a stranger on a phone:**

> *"it's hard to tell that I should click the constellations, or that I can
> click certain reflections when inside the constellations."*

The cause, stated narrowly: **every affordance in the Sky was a `:hover` rule.**

- On the overview the row is a link, but at rest the name is plain
  `base-content` — no underline, no colour, no mark. All of the "this is a door"
  signal lived in `app.css`'s `.group:hover .sky-name`.
- Inside a suite it is worse, because the list is **mixed**: only writing
  stanzas open anything, and the distinction between a tappable essay and an
  inert quote was carried entirely by `.suite-writing:hover`.

A thumb receives none of that. So on the surface where a first-time visitor
actually arrives, the site offered no indication that anything opened.

⚠ **And the lamplight impersonated it.** `.is-lit` warms a quote's blockquote
and a writing's title with the same gesture. On touch that was the *only*
feedback the page ever gave — so the one dynamic thing a phone saw actively
taught **"everything here glows"**, which is the opposite of *"this one opens."*
That is the part no amount of hover polish reaches: the page was not silent on
touch, it was misleading.

⚠ **Resizing a desktop browser to 390px does not reproduce a phone.** The
pointer is still a mouse and every hover rule still fires, so the page keeps
handing you an affordance a thumb will never receive. This is why the problem
survived a year of responsive testing, and it is the single most transferable
line in this ADR.

## Decision

**Affordance in the Sky is input-conditional, and the two inputs get two
models rather than one model with a switch.**

**1. On touch, three signals arrive as one thing.** Colour, a margin mark, and
a call-to-action word, deliberately on the *same* focus and the *same* easing
so the row reads as one arrival rather than a checklist of effects. Michael,
after driving four candidate treatments: *"a combination of B, C, and D is
actually the best implementation… they all have elements that help guide the
user."* The word sits **below** on its own reserved line, so nothing on the
page ever moves.

**2. Pointer and touch each consult exactly one ambient input, and the other
is never read.** Proximity ("what am I looking at, on a device that cannot
point?") answers a different question from hover, and it is not asked at all
where a cursor exists. See `focusTracker` in `scripts/focus-mode.ts` for the
table.

**3. The lamplight itself is not input-conditional and stays on desktop.** It
is atmosphere, and it shipped long before this question. Only the *affordance
riding it* went touch-only — which is what stops it lying: once only the
openable stanzas have a word for it to warm, warming every stanza is no longer
a claim about what opens.

It lives in `app.css` ("The overview's stars" / "The Sky"), `index.astro`,
`ConstellationSuite.astro`, and `scripts/focus-mode.ts`.

## Consequences

- **The Sky is the first surface on this site whose behaviour differs by input
  device**, which is a new class of thing to get wrong. The guard is that the
  split is expressed once, in `focusTracker`, rather than as `@media (hover)`
  scattered through `app.css`.
- ⚠ **Testing it requires switching the input model, not the viewport.** A
  chromium run at 390px — which is what `playwright.config.ts`'s `mobile`
  project is — still fires hover. Nothing in the e2e suite can currently see
  this decision working or broken; it is a real-hardware check.
- ⚠ **This ADR is why `/afford-lab` could be deleted** (2026-08-10, plan 31 §7,
  ~1,520 lines). The bench held treatments A–D, and its header argued they were
  *"the only record of what E is made of"* — true while the argument lived only
  in that file. The argument is here now; the four prototypes are in
  `git log -- src/pages/afford-lab.astro`. **The bench's own exit condition was
  "delete it when the question stops being live", and writing this ADR is what
  made that safe.**
- The margin **glyphs** experiment left the stars sized for a glyph that is no
  longer there. Not a defect — recorded because a future glyph would have to
  re-answer it.

## Alternatives

**Add a hover-off fallback (`hover: on/off`).** The first shape, and it
shipped as far as the bench. It only ever *subtracted*, so proximity kept
running underneath and a desktop had **two systems narrating at once** — rows
lighting as you scrolled while the cursor lit a different one. Michael,
2026-08-07: *"it gets a little janky or a little too visually busy … now the
mouse hover and the scrolling are competing for attention."*

⚠ **The fix is not precedence, and this is the load-bearing correction.**
Precedence only stops two systems *contradicting* each other; it cannot stop
them both being in motion. That is why the decision is two models rather than
one model with an override.

**Any one of the three signals alone (treatments A–D).** Each was legible and
each under-delivered on the mixed suite, where the question is not *"is this a
door?"* but *"which of these eleven is a door?"* Spending three signals on one
job is only defensible next to what one signal bought, which is the argument
the bench existed to make.

**Motion at rest (`beckon: always`).** Rejected. On a page of eleven rows it
costs nothing on the first visit and everything on the fiftieth.

**The word inline rather than below (`cta: inline`).** Rejected on phones. It
holds no width at rest — it sits in the name's flex row, so any width it took
would be width stolen from the name — and therefore has to unfurl from zero.
On the longest name in the sky that unfurl bumps the name onto a second line,
which is the entire reason `below` exists.

**Card the writing stanzas.** Rejected earlier and separately, on `/sky-lab`,
2026-07-23: each medium keeps its own register rather than becoming a card.
Carding would "solve" discoverability by discarding the thing worth walking
through. Recorded here because it is the obvious repair and it is already
settled.

**Tap confirmation (`press`) and an explanatory intro line.** Both built, both
not shipped. `press` only means anything under a thumb and wants a real-device
sitting of its own; the intro line explains what the design should assert.
