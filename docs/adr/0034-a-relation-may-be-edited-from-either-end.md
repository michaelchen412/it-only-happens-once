# 0034 — A relation may be edited from either end

Status: **Accepted** *(2026-08-12 — built the same day it was written. It
reverses a decision taken on 2026-08-11 and states the general rule that
decision got locally right and globally wrong.)*
Date: 2026-08-12

## Context

An essay may point at a song through `fragments.paired_song_id`
([ADR 0011](0011-paired-media-is-a-fragment.md)). The column lives on the
**writing**; the one action that writes it is `songs.pair`.

For the whole life of that relation it had exactly **one** editing surface: the
writing sheet's Music tab. That was not an accident of construction — it was
argued for in a ⚠ comment in `SongSheet.astro`, written 2026-08-11:

> ⚠ **NOT EDITABLE, and that is the decision rather than a shortcut.** Pairing is
> the ESSAY's decision — `songs.pair` is called from the writing sheet's Music
> tab, which is where you are when the question "what goes with this piece?"
> actually arises. A second control here would be a second write path for a
> relation that already has one, and the pairing would then have two homes that
> could disagree about which essay a song belongs to.

A day later, using it:

> "As I'm listening to a song, decide: *hey, this kind of reminds me of what I
> want to write about here. How can I assign that?* Right now, I have to close
> the song and then reopen the fragment browser and then assign a song to it.
> It's a little bit of a headache."

### The measurement that turned a preference into a defect

Closing the song sheet **destroys the player's iframe**, and that is not
incidental: a cross-origin frame cannot be controlled from outside, so removing
it is the only pause the workshop has. Which means the sole route to the pairing
control was reachable **only by ending the listening that produced the thought.**

The old route, counted: close the sheet (silence), find the essay in the Fragment
Manager, open the writing sheet, cross to its Music tab, retype the song's name
from memory, pair, close, reopen the song. Six moves and a silence, to write one
foreign key that was decided in the first two seconds.

### Which half of the old argument was wrong

**The framing was right and is kept**: *"where you are when the question actually
arises"* is the correct test for where a control belongs. It was applied to one
question. There are two, they are different, and they arise in different rooms:

| the question | where you are | the door |
|---|---|---|
| *What song goes with this piece?* | the writing sheet, mid-draft | Music tab |
| *What am I going to write about?* | the song sheet, mid-listen | Facts tab |

**The reasoning was wrong**: *"a second write path"* conflated two things. Both
doors call one `songs.pair`, against one column, with one enforcement of
`type = 'writing'`. There is no second path and nothing that can disagree.

That conflation is easy to make and worth naming, because it will be made again:
the comment was written in the hour plan 37 collapsed **two** song editors into
one, and guarding against a third surface was the mood of that work. Consolidating
editors and adding a second entrance to one relation look alike and are opposites.

## Decision

**The invariant is one write path, not one control.** A relation may be given an
editing surface at either end, provided every surface calls the same action
against the same column with the same guards.

A control earns its place at an end when **the question it answers arises there** —
not merely when the data is visible there. Visibility is not a reason to add a
control; it is a reason to show a fact.

**Corollary — the two ends are not the same verb, and the surface must say so.**
Where the cardinality is asymmetric, one end replaces and the other appends into
a slot that may already be occupied. The end that can take something belonging to
a row you are *not looking at* must name what it is taking, and confirm.

## Consequences

**Applied here.** The song sheet's Facts tab now lists the pieces a song is paired
to, each with **Unpair**, plus a **＋ Pair with a piece** door onto the
`FragmentBrowser` in a new `mode="pair"` — writing only, single-select, no
editors. `SongSheet.astro`'s ⚠ block is rewritten in place with the reversal and
its reasoning, per the house rule that a losing alternative is written down.

⚠ **The cardinality asymmetry is recorded for the first time.** A writing has at
most **one** song — `paired_song_id` is a single column. A song may be paired to
**many** writings; there is no unique constraint and none is wanted. Nothing in
the repository said this before, and it is the fact that makes the two doors
behave differently. It is also the fact a future session is most likely to get
wrong — most obviously by "fixing" the song sheet to show one pairing.

**What this does NOT license.** A second control is still a cost: more surface,
more markup, another place to keep honest. This ADR says *where the question
arises* decides, and that test refuses more often than it permits. `score_url` —
a constellation's own song — was examined at the same time and **does not** get a
second door: *"what music accompanies this constellation"* is not a question that
arises while listening to one song.

**The picker is now two rooms' surface, so it stopped being one room's component.**
`FragmentBrowser` was constellation-shaped throughout; the browsing half moved to
`browser-shell.ts` and each mode owns its verb. ⚠ The drawer's `#fb-*` ids became
classes: `/admin/fragments` now renders a manage-mode panel **and** a pair drawer,
and two `#fb-panel`s on one page is one `#fb-panel` and a silent bug. The panel it
wraps was written class-scoped from the start for this exact reason — only the
shell never followed.

**Superseded reasoning, not a superseded ADR.** [ADR 0011](0011-paired-media-is-a-fragment.md)
is untouched: it settled that a pairing is a foreign key to a real fragment, and
that is still true. What changed is only where the key may be typed.
