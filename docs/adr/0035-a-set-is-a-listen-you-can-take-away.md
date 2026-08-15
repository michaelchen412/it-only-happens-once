# 0035 — A set is a listen you can take away

Status: **Accepted** *(2026-08-15)*
Date: 2026-08-15

Supersedes [ADR 0031](0031-a-song-carries-a-feeling-not-an-idea.md) entirely,
and the **annotated-fragment role** of [ADR 0009](0009-music-three-roles.md)
along with it — 0031 had already taken that role, and this takes what 0031 put
in its place. ADR 0009's other two roles are untouched: the constellation score
survives, and the paired song survives and is now the only thing a song does.

## Context

Two ADRs and a plan had been circling one question — *if the music speaks for
itself, why would anyone come here rather than to Spotify?* ADR 0009 answered
**"Spotify has no field for why"** and gave a song a `body`. ADR 0031 found the
annotation went unwritten, kept the field, and moved the organising work onto a
new axis: a song would be filed by what it **did to you**, from a shared
vocabulary of feelings, in a room at `/blog?view=music`.

All of it was built. The room worked — a bitmask facet index, contextual counts,
dead-end words, a FLIP-animated collapse, players that survived a filter change.
None of that is what failed.

**In seventeen days, one song out of forty-eight was ever tagged.** One public
note was ever written. The vocabulary grew to 54 words while the room's facet
index could carry 31, so 23 of them were being silently dropped from a palette
nobody was filling.

Michael, 2026-08-14, on why:

> I don't think I would index my music the same way I would index it in Spotify,
> which is a dedicated app for music and a dedicated app for sharing music.

And on what he wanted instead:

> I want them to be able to save that playlist, and they can play that playlist
> in their library whenever they're feeling that certain way. Whereas with this,
> you kind of have to reopen the site every time.

That is the sentence this ADR turns on, and it is not a complaint about the
room's design. **The room asked people to stay. The thing he wanted asks them to
leave with something.** No amount of good filtering reconciles those.

## Decision

**A set: one curated Spotify playlist, one quote, one description.** It replaces
the room at `/blog?view=music`, and the tab strip does not move.

1. **A set is not a fragment and not a constellation.** It gets its own table.
   A fragment is text with subjects, placeable in a constellation, readable at a
   URL; a set is none of those. A constellation is where an idea is worked out;
   **a set is where a feeling is isolated.** Reading versus recognising.

2. **The title is an utterance, not a label.** *"What would you still do, if you
   knew you would fail?"* — a question put to the listener, or a sentence one
   person says to another. Not a mood word. A corny title describes an emotion
   from outside; these enact one. Sentence case, where a constellation is
   lowercase, because that is the cheapest signal that a listen is not a read.

3. **Exactly one quote, or none** — a real fragment from the Library, so it
   carries an author and may be the same row a constellation places. A quote is
   *addition*, not annotation: printing "redemptive · defiant" under a set
   explains the joke, while another voice saying the thing differently does not.
   Singular in the schema rather than a capped array, because a cap is a rule
   someone must remember and a scalar is one the compiler keeps.

4. **The description is the "why" ADR 0009 was right about.** Spotify still has
   no field for it. What changed is the grain: **one sentence per set rather
   than one per song** — seven decisions instead of forty-eight, which is the
   whole reason this gets written when the annotation did not.

5. **The feelings vocabulary is retired**, tables and all, and songs stop being
   fragments. `paired_song_id` survives untouched and is the only thing a song
   is for.

6. **A song may still not cite a playlist** (ADR 0009 holds). A playlist belongs
   to a constellation as its `score_url`, to a single essay as
   `paired_playlist_url`, or to a set. Three homes, one rule: a playlist is a
   curated thing and a song is a recording.

## Consequences

- **The public blast radius was zero**, which is what made the retirement
  affordable. Nothing a reader could reach was a song: `/blog/<song-slug>` 404'd,
  RSS excluded songs by argument, and the index queried two types.
- **Songs get their own table** and every `except songs` branch — ~17 files —
  goes with it. The fragment type union becomes `writing | quote`, which is
  finally a coherent claim rather than three things sharing a table.
- **The room's grammar survives its mechanism.** The sets index reuses the
  field's typographic behaviour — selected goes `--color-primary`, the rest
  recede — deliberately, so what Michael liked about looking at the room outlives
  the code that produced it.
- **Accepted loss: a visitor can no longer explore by feeling.** Seven fixed
  doors replace a spectrum anyone could combine. That is a real reduction in what
  the site *could* do, traded for something it will actually contain.
- **Accepted loss: 54 words.** Recorded in
  `supabase/migrations/20260815161554_the_feelings_were_never_tagged.sql`, in
  sort order, because the order was the claim.
- **What would falsify this:** sets going unwritten the way annotations did. The
  measurement is the same and so is the remedy — if seven descriptions are still
  empty in a month, the problem was never the grain, and the honest read is that
  the site does not want a music section at all.

## Alternatives

- **Generate a playlist per feeling from the tags.** The obvious use of the
  vocabulary, and dead on arrival: Spotify's Web API needs the *visitor* to
  authorize, and since February 2026 a development-mode app is capped at five
  authorized users, with extended access requiring a registered business and
  250k MAU. Michael-owned playlists per word were reachable — but a derived
  playlist can only ever *be* its filter, which is why "the sad playlist" reads
  as thin. It is queried, not curated, and you can feel the difference.
- **Play the room in place** — drive one embed through the filtered set with
  Spotify's iFrame API. Prototyped in argument and rejected on the premise: it
  keeps people here, and the point is to let them leave. It also plays 30-second
  previews for anyone not signed in.
- **Keep the room and populate it slowly.** The measurement is what refused
  this. Tagging is per-song, unproposable by design (*"AI can't tell me what I
  feel"*), and one in forty-eight after seventeen days is not a slow start.
- **Sets as a kind of constellation.** Genuinely close — same shape, same
  curation, and one playlist is even named after a published constellation. Kept
  apart because the verbs differ: you finish a read, and you never finish a
  listen, you save it. Where a theme has both, they should point at each other
  rather than be one row with a discriminator.
