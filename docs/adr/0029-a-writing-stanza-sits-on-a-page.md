# 0029 — A writing stanza sits on a page, and the page has no left edge

Status: **Accepted** *(2026-08-11)*
Date: 2026-08-11

## Context

A constellation suite sets every fragment **in its own register** — the rule at
the head of admin.css's Sky section since 2026-07-23, prototyped on the dev-only
`/sky-lab` bench. Until now that header stated the rule as **"typeset, not
carded"**, and every stanza was accordingly set bare: no container, no edge.

That phrasing conflated a principle with one of its consequences. "Each medium in
its own register" is the principle. "Typeset" was simply what all three registers
happened to be at the time — and it hardened into a prohibition, so that the
question *"which register does an essay actually belong to?"* stopped being
askable.

It is worth asking, because the three stanzas are not the same kind of object:

- a **quote** is set whole. It finishes on the screen. Clicking it adds
  provenance and a share mark to something already complete (ADR-0023).
- a **song** leads with Michael's annotation and closes with the embed as
  citation (ADR-0009). Also complete.
- **writing** is a title and five clamped lines with a fading tail. The piece is
  *elsewhere*. A reader who does not click has not read it.

ConstellationSuite already encodes that asymmetry twice — only writing gets a
`Read →`, and only writing's title carries a trace of the lamp at rest — each
time by adding another small signal to a stanza that otherwise looks identical to
its neighbours. The asymmetry was real and the register was being asked to carry
it in increments.

## Decision

**A writing stanza sits on a page. A quote and a song stay typeset.**

The sheet is a `::before` on the stanza's text column, carrying tint, hairline
and radius together, and **it fades in from the left** — no substance at all on
its left edge, arriving at full strength ~58% across.

The left edge is not a stylistic flourish; it is what makes the sheet admissible
at all:

> The arcs of the drawn figure bow up to 30px off the margin marks, and stanzas
> paint **above** the line (`.suite-item` is z-index 1, `.suite-line` is 0). A
> sheet with a solid left edge therefore **eats the constellation** where it
> crosses.

*Amended 2026-08-11, the same day, and the reasoning survives the amendment
intact.* The figure stopped being arcs hours after this was written — it is now
one centripetal Catmull–Rom spline through the marks (`lib/sky-figure.ts`), so
"bow up to 30px" no longer describes anything. **The premise it was supporting
is unchanged and in fact strengthened**: the line still crosses the sheet, the
stanza still paints above it, and a solid left edge would still eat the drawing.
The new figure strays *less* — measured max lateral distance from the nearest
mark is 16.6px at 1280px and 1.7px at 390px, against the arcs' 16.5px and 10.1px
— so it sits further inside the transparent zone rather than testing it.
`--sw-reach` needed no retune.

Michael, 2026-08-11: *"slowly gains opacity from left to right so it blends in
better with the constellation lines and is less jarring."* Every other candidate
asked the reader to accept an object dropped on the drawing. This one lets the
drawing win, and only becomes paper once clear of it. **The figure and the paper
are consequently no longer independent** — changing `INDENTS` in
ConstellationSuite moves both.

The excerpt goes from four clamped lines to five, because a page with four lines
on it is not a page. It stops at five because `excerpt()` caps the lede at 400
characters: at six or more, most essays stop being truncated at all and
`.excerpt-fade` becomes a mask over text that was never cut.

The `Read →` stays **in the flow, beneath the excerpt**, at the sheet's outer
corner.

## Consequences

**The header rule was restated, not weakened.** admin.css now says "each medium
in its own register" and names the technique per register. A future reader who
finds a card in the Sky and remembers a prohibition against cards will find the
prohibition was against the wrong noun.

**One definition serves two surfaces.** The sheet is keyed on `.suite-writing >
.grow` — the two elements that both the public suite *and* the composer's Read
view already build, the latter deliberately ("the same stanzas the sky sets,
verbatim"). Neither can drift, and the composer keeps showing the real thing. The
cost is a coupling worth naming: renaming either element, or moving the `Read →`
out of `.grow`, silently stops the page being one. Both components' headers say
so at the point of risk.

**Two mask layers must multiply.** The sheet's second axis — denser under the
title, thinner at the foot — is a second `mask-image` composited with
`mask-composite: intersect`. The default is `add`, a union, which would restore
the left edge to full strength wherever the vertical layer is opaque. **The
fallback does not weaken this effect, it inverts it**, so the horizontal-only
mask is the floor under `@supports` and the second axis is added only where the
multiply is real.

**Both ramps are eased, for two different reasons, and neither is taste.**
Horizontally, the sheet differs from the ground by roughly 2% lightness, so a
two-stop ramp over ~350px resolves to a handful of 8-bit values held for 60–100px
each — a staircase. Easing makes the steps uneven, and uneven steps read as
texture where evenly-spaced ones read as a defect. Vertically, `black 0%, black
34%, …` was built and printed a **Mach band** across the middle of the card: the
eye draws an edge wherever a gradient stops being flat, even when every value on
both sides is correct.

**A border cannot fade, so the edge left the box.** `border-image` with a
gradient is the obvious reach and it silently discards `border-radius` — square
corners, every time. The footer rule has the same problem in miniature and the
same answer: it is a 1px gradient *background* on the sheet's own ramp, not a
`border-top`, because a border would put a hard stroke across the exact stretch
where the paper has been reduced to nothing.

## Alternatives rejected

All four were built on the bench (`/lab/page-card`, deleted with this change —
see `git log` for it) and driven against the real corpus, in situ between real
quotes under the real lamplight, rather than judged from a gallery.

- **leaf** — a plain hairline sheet. The honest baseline, and it loses only to
  the figure: its left edge crosses the arcs.
- **recto** — no edge, a shadow. Breaks `--depth: 0` ("flat. restraint IS the
  warmth") and pays for it with almost nothing on dusk's near-black, where a
  black shadow is close to mute.
- **stack** — two sheet edges peeking below, "page one of several". The most
  literal reading of the ask, and opaque by construction: a stack of translucent
  sheets is mud. Opacity is what the figure cannot afford.
- **`Read →` arriving with the reading light** — the turn absent at rest,
  appearing over the text on `.is-focus` (the cursor on a desktop, the lamplight
  on a thumb — ADR-0022) on an opaque plate that hid the text beneath it. It
  worked, and it was rejected as less clean than a word that simply sits under
  the excerpt where a reader already expects it. Michael: *"I've settled on wash
  and then the regular read part underneath. its cleanest."*

That last one is the expensive lesson, and it is recorded because the cost was
not in the idea: it took four rounds to make the reveal not flicker, and three of
those were the same bug wearing different clothes. **On this surface the cost is
never the value, it is the layer** — an ancestor with `opacity < 1` becomes a
backdrop root and starves a `backdrop-filter` until the transition ends; an
element that *gains* a filter must be promoted and rasterised at the exact moment
it is asked to animate. Anything future work adds here that fades a filter or a
backdrop needs a no-op one mounted at rest, and needs nothing translucent above
it. The fourth round was not a layer bug at all — it was two things sequenced in
the wrong order, diagnosed only by measuring real pixel luminance frame by frame,
after both author and reviewer had guessed wrong from computed styles.
