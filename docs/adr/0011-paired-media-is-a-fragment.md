# 0011 — A paired song is a fragment row, and it leads the essay

Status: Accepted
Date: 2026-07-31

Settles two of the three questions [ADR 0009](0009-music-three-roles.md)
deliberately left open. The third — whether `/listening` exists — stays open.

## Context

ADR 0009 gave music three roles and named **paired media** as one of them:
*this song goes with this piece*. It found the evidence in the corpus rather
than in a wish — 50 of the 51 imported essays carry a Spotify link in
`details.media`, a decade-long habit brought over from Squarespace and rendered
nowhere for the entire life of this site.

It then deferred the two decisions that would make it real:

> whether **paired media becomes a fragment row** — able to carry subjects and
> be searched — or stays an attribute of the essay in `details.media`;
> […] whether a stanza's embed loads **eagerly or on click**.

Two things forced the question in July 2026. Plan 04 Piece 4 shipped the Spotify
Web API, which is the only thing that knows the artist of a bare track URL — the
missing metadata that had made rendering these pairings impossible in the site's
own typography. And the corpus turned out not to be what the plan recorded.

**What the 50 actually are** (counted, not assumed):

| | count | can a song fragment cite it? |
|---|---|---|
| Spotify **track** | 45 | yes |
| **YouTube** video | 3 | yes — a song is a song, and YouTube's oEmbed even names the channel |
| Spotify **playlist** | 2 | **no** — ADR 0009 gives playlists to constellations as scores |

And two tracks are each paired to *two* essays, so "one song per essay" is not
"one song row per essay."

**The objection to promoting them, stated fairly**, because it nearly won: 45
song fragments with `body: null` is precisely the *"only fragment type
containing no voice of its own"* that ADR 0009 rejected on sight. Creating 45 of
them in one command looked like undoing that ADR by bulk insert.

It doesn't, and the reason is worth recording. **A published song fragment has
no public surface of its own.** `/blog` has exactly two views, Writing and
Quotes; a song has no permalink; `/sky` shows constellations. A song appears in
public only as a stanza inside a constellation someone placed it in. So promoted
pairings are invisible until placed — which is the correct default for 45 songs
nobody has written a word about.

And the deeper answer: **the essay is the annotation.** ADR 0009's rule is that
a song fragment needs a voice; a paired song has one, six thousand characters of
it, sitting immediately below. The pairing *is* the "why."

## Decision

**1. A paired song is a fragment row.** `fragments.paired_song_id` — a self-FK,
`ON DELETE SET NULL` — points an essay at a `song` fragment. 48 of the 50
imported pairings were promoted (`scripts/backfill-paired-songs.mjs`); the 2
playlists keep rendering from `details.media`, which becomes a read-only legacy
path that nothing writes.

**2. It renders at the head of the essay** — below the title block, above the
prose. *Press play, then read*: the same invitation a constellation's score
makes above its suite, but scoped to the piece.

**3. Songs may cite YouTube**, not only Spotify. Three of the imported pairings
are videos and they are songs.

**4. The embed stays eager**, closing out ADR 0009's second open question — but
the reason is not the one that question anticipated. Every surface except the
permalink renders `PostArticle` inside a `<template>`, whose contents are inert,
so a seven-essay page of `/blog` loads **zero** third-party frames (measured).
Eager costs nothing where the cost was feared, and click-to-reveal would buy
nothing but a click.

## Consequences

- **Paired songs can now carry subjects, be searched, and be placed** in a
  constellation. That was the whole argument for a row, and it is available the
  moment one earns it.
- **A pairing is editable**, in the writing sheet's new **Music** tab. It applies
  immediately, like constellation membership and for the same reason: a relation
  is not a field of the document, so pairing must never ride along with the
  compare-and-set save and risk a rewrite — and a draft must be pairable without
  opening a publish dialog it never opens.
- **RLS covers the pairing for free**, but only if the reader is written
  correctly. A PostgREST embed re-applies the fragments policies, so an
  unpublished paired song comes back null. The reader must treat *id set, embed
  null* as **no pairing** — never as "fall back to `details.media`." All 48
  promoted essays still carry that legacy column pointing at the same track, so
  a fall-through would go on playing a song you had just unpublished. This was a
  real bug, caught by probing live rather than by reading the code, and it is
  pinned by `src/tests/paired-media.test.ts`.
- **The FK cannot enforce `type = 'song'`.** A composite FK on `(id, type)`
  needs a generated column holding the constant, and a generated column cannot
  be set to null — which is exactly what `ON DELETE SET NULL` must do. Keeping
  the delete semantics was worth more; the type check lives in the `songs.pair`
  action.
- **Accepted downside — 46 songs that say nothing.** The corpus went from 2 song
  fragments to 48, and 46 have no annotation. They are invisible until placed,
  and each is a standing invitation to write the sentence. The failure mode to
  watch is the one ADR 0009 named: a song that could equally be any of the three
  roles.
- **Accepted downside — the writing sheet has a fourth tab**, and its command row
  was already documented as overflowing on a 390px screen. Measured: 501px →
  565px of content in a 389px drawer. Recorded in
  `tests/e2e/admin-layout.mobile.spec.ts` so a known defect getting worse stays
  known.
- **`occurred_at` on a promoted song is the essay's year, not 2026.** A song's
  date means *when you added it*, and these were added when the essay was
  written. Two 2022 essays and 43 from 2023 say so.

## Alternatives

- **Leave it in `details.media`** (recommended, and overruled by Michael — the
  right call). It renders identically for less work. Rejected because it makes
  the pairing permanently second-class: no subjects, no search, no placement,
  and no path to an annotation without a migration later anyway. The flood
  objection that motivated it turned out to be false, since songs have no public
  listing.
- **A join table.** Rejected — the relation is 1:1 from the essay's side, and a
  join table would model a many-to-many nobody wants and no UI would offer.
- **Promote only the 45 Spotify tracks; drop the rest.** Rejected: it would have
  silently ended five essays' pairings, three of which are songs that merely
  aren't on Spotify.
- **Clear `details.media` after promoting.** Tempting — it removes the dual path
  entirely and would have prevented the fall-through bug by construction.
  Rejected as destructive: it is the only record of what Squarespace actually
  held, it costs nothing to keep, and the correct branch order is one `if`.
- **Foot of the essay rather than head.** Genuinely arguable, and the more
  conservative read of ADR 0009's "the embed is demoted from content to
  citation." Michael's call was the head, and the score precedent supports it:
  music that accompanies a read should be reachable *before* the read, not
  discovered after it.
