# 0009 — Music in three roles; a song fragment carries its own voice

Status: **Accepted — the third role (the annotated song fragment, and `body` as
its "why") superseded by
[ADR 0031](0031-a-song-carries-a-feeling-not-an-idea.md)** *(2026-08-11)*
Date: 2026-07-25

> ⚠ **Read 0031 before trusting the "Decision" section below.** The **score** and
> the **paired song** — roles 1 and 2 — stand exactly as written, and so does the
> external-constraints analysis that produced them. What is superseded is the
> third role: one song in seventeen days used the voice this ADR gave it, and the
> sentence it used it for was a *note*, not a *why*. A song is now filed by
> **feeling**, and the answer to the playlist objection below is placement rather
> than annotation.

## Context

The site shipped with `song` as one of its three fragment types and then went its
entire life with **zero songs in it**. The first real one landed on 2026-07-25,
and seeing it on the page immediately raised the question the type had been
deferring: *what are songs actually for here?*

Three desires collided, in Michael's words:

1. music as **accompaniment** to a constellation or a piece of writing;
2. *"a place where I can share with someone — hey, this is the music that I love
   and why"*;
3. *"I also want to let the music speak for itself."*

And with them the objection that makes the whole thing hard: if the music speaks
for itself, **why wouldn't someone just share a Spotify playlist?**

**Two hard external constraints.** If you want audio playing on a public page,
the Spotify **embed is the only sanctioned surface**: the Web Playback SDK
*"requires a Spotify Premium subscription"* and the `streaming` scope requires
each **visitor** to authorize, while preview clips *"cannot be used as a
standalone service or product."* And the embed's interior **cannot be styled** —
it is a cross-origin iframe; we control its size, its corner radius, and what
surrounds it. Nothing else.

**The first attempt failed, and the failure was diagnostic.** A song was rendered
as an embed stanza inside the suite. It looked wrong immediately — but not
because of the styling. Look at what a song fragment contained: a Spotify link, a
title, an artist, an album, a year, and `body` hardcoded to `null`.

> A quote holds someone else's words plus who said them. An essay holds
> Michael's words. A song held **only a pointer to Spotify** — the one fragment
> type containing no voice of its own, sitting in a sequence where everything
> else speaks.

A second mismatch compounded it: **time.** A quote takes ten seconds to read, an
essay five minutes; a song takes four minutes *whether or not you are reading*.
Text sequences with text because the reader holds the clock. Music accompanies —
it does not queue.

**The corpus already held the answer.** 50 of the 51 imported essays carry a
paired Spotify track in `details.media`, brought over from Squarespace and never
rendered since. Pairing a song to a specific piece was not a hypothetical
capability to weigh — it was a decade-long habit the current site had silently
dropped.

## Decision

**Music takes three distinct roles**, answering three different questions:

| Role | Scope | Question it answers | Where it lives |
|---|---|---|---|
| **Score** | constellation | *play this through the read* | `constellations.score_url` |
| **Paired media** | one essay | *this song goes with this piece* | `fragments.details.media` |
| **Annotated song fragment** | itself | *this song, and why* | a `song` fragment |

They are not competing presentations of one idea; a constellation may have any,
all, or none of them.

**And a song fragment gains a voice: `body` becomes its annotation** — Michael's
sentence (or few) on why this song. The Spotify embed stops being the content and
becomes the **citation** — structurally what a small-caps attribution is to a
quote:

- a **quote** is *someone else's words* + who said them;
- a **song** is *Michael's words about it* + the track itself.

Both are the same gesture: *here is a thing that isn't mine, and here is my
relationship to it.* This is also the answer to the playlist objection —
**Spotify has no field for "why."** You can name a playlist, order it, and
describe it in a few hundred characters; there is nowhere to say why track seven
is there. That gap is precisely what a fragment exists to hold.

The annotation is **optional**. A song may still say nothing and simply play.

## Consequences

- **No migration.** `fragments.body` already exists as nullable `text`; songs
  simply stop writing `null` into it. The change is the editor and the action,
  not the schema. ([data-model.md](../data-model.md) §`body`'s comment — "full
  essay OR full quote text" — needs widening when this ships.)
- **The suite stanza inverts**: Michael's words lead, the embed closes. The
  player is *supported* by text rather than standing naked in quiet typography,
  and the stanza stops opening with a title that reads like an essay's.
- **The annotation doubles as the fallback.** Every embed is a third-party
  cross-origin frame that loads Spotify's JS and is routinely blocked by content
  blockers; a blocked stanza now still leaves a sentence rather than an empty
  space with a `♪` in the margin.
- **A `/listening` surface becomes coherent** rather than redundant: the playlist
  link can sit at the top for anyone who wants bulk, while every item below it
  carries a reason. That is the thing a shared playlist structurally cannot do.
- **Albums become a small extension, not a new idea.** `parseSpotifyEmbed`
  already handles album URLs; only `saveSong` (which demands a *track* link)
  stands in the way.
- **The Spotify Web API earns a job unrelated to capture friction.** The 50
  paired tracks are stored as **URLs only** — no title, no artist. Rendering
  them in the site's own typography requires that metadata, and
  `GET /v1/tracks?ids=` resolves all 50 in one batched call. oEmbed cannot: it
  returns a title and no artist.
- **Accepted downside — three concepts where there was one.** Mitigated by each
  answering a different question; the failure mode to watch is a song that could
  equally be any of the three.
- **Accepted downside — the embed is still un-stylable and still loud.** We are
  choosing where it appears and what surrounds it, not what it looks like.

**Deliberately left open** (a later ADR, not this one):

- whether **paired media becomes a fragment row** — able to carry subjects and be
  searched — or stays an attribute of the essay in `details.media`;
- whether a stanza's embed loads **eagerly or on click**;
- whether `/listening` exists at all.

## Alternatives

- **Playlist-only — drop songs as fragments entirely.** Genuinely tempting: it is
  more elegant visually and sonically, and it removes every embed from the suite.
  Rejected because a background playlist **cannot pair at all** — reading speed
  varies by a factor of three, so no ordering keeps a track aligned with a
  fragment. The cost is not looser pairing; it is *no* pairing, and it would
  discard 50 pairings that already exist. It also makes music the only medium on
  a site of fragments that isn't one — atmosphere rather than a limb.
- **Song as a bare embed stanza** (built and rejected on sight, 2026-07-25). See
  Context: the only fragment type with nothing of its author in it.
- **A custom-styled player.** Not available at any price — the SDK requires each
  *visitor* to hold Premium and authorize, and preview clips may not be used as a
  standalone product. Spotify's iFrame API (`createController`, `play`, `pause`,
  `playback_update`) does allow driving an embed from our own controls, which is
  a real option for *when* and *how* the frame appears — but never for what its
  interior looks like.
- **A separate "note" concept attached to a song.** Rejected — `body` already
  means *the words of this fragment*, and a song's words are Michael's words
  about it. Same column, same meaning, no new concept.
- **Long-form writing about each song (a review).** Rejected as the *default*: a
  sentence situates the listener, a review explains the music away — which loses
  desire (3), letting it speak for itself. Nothing prevents a longer body when a
  song earns one.
