# 0031 — A song carries a feeling, not an idea

Status: **Proposed** *(2026-08-11. The four rulings below were taken in
conversation; nothing is built yet. It becomes Accepted when the work lands —
this site's habit is to describe what shipped, and the one claim here that could
still be wrong is what a note actually gets used for.)*
Date: 2026-08-11

Supersedes the **third role** of [ADR 0009](0009-music-three-roles.md) — the
annotated song fragment. The other two roles, the constellation score and the
paired song, are untouched and are now the only two.

## Context

[ADR 0009](0009-music-three-roles.md) was written on 2026-07-25, the day the
first real song landed, and it answered a good question — *if the music speaks
for itself, why wouldn't someone just share a Spotify playlist?* — with a good
answer: **Spotify has no field for "why."** So a song fragment got a voice.
`body` became the annotation, Michael's sentence on why this song, and the embed
was demoted from content to citation.

[ADR 0011](0011-paired-media-is-a-fragment.md) then promoted 48 imported
pairings to `song` rows six days later. Its defence against *"you have just
created 46 fragments with no voice of their own"* was that they are invisible
until placed: *"a song appears in public only as a stanza inside a constellation
someone placed it in."*

**Seventeen days later the corpus has run the experiment, and it answered every
question this record exists to settle.** Counted 2026-08-11, over 48 live songs:

| | |
|---|---|
| paired to an essay | **46** |
| carrying a "Why this one" | **1** |
| carrying a subject | **0** |
| placed in a constellation | **0** |

**Three of those four numbers are a verdict, and the fourth is the diagnosis.**

**The annotation.** One song in seventeen days used the voice ADR 0009 gave it —
and it is *the ADR's own worked example*, **Hush** by Bob Reynolds, created on
2026-07-25. Here is the only annotation this site has ever held:

> "It's a beautiful song. I love Janek's playing in the beginning; it really sets
> the tone for the whole piece."

**Nothing in that sentence is a *why*.** It justifies nothing and recommends
nothing; it is an observation about a sideman's playing that Michael wanted to
keep. The single time the field was filled, it was filled as a **note** — so the
field has been mislabelled since the hour it was created, and the label is what
kept it empty for the forty-seven songs after it. Michael, 2026-08-11:

> "I don't think I would ever talk about why this one. Every piece of music is
> special to me… I want to let the music do its own speaking. It's a beautiful
> art form, and the truth is in listening to it yourself. I don't need to tell
> you why the music is good."

> "That's violating a really big aesthetic principle of mine — I want to show and
> not tell."

**The subjects.** Zero of 48, and the one time a song was filed by subject it got
tagged `jazz` — a genre, alone in a taxonomy of twenty-one words about living,
attached to no essay and no quote. That row was deleted on 2026-08-11 as a
category error. Michael: *"while quotes and writing obviously have subjects,
songs don't have subjects in the same sense."* A subject is what a piece is
**about**, and a song is not about anything you can paraphrase — which is most of
why it is worth having.

**The constellation.** Zero of 48, and by conviction rather than backlog:

> "I don't foresee myself adding songs directly to constellations… I wouldn't add
> that to a constellation because it doesn't quite represent an idea. Rather,
> it's an accompaniment to the constellation, whether as top-level playlists or
> paired with each writing fragment."

**So ADR 0011's premise turned out false in the other direction.** It argued the
promoted songs were *invisible until placed*; nobody ever placed one. Songs have
therefore had **no public surface of their own for the entire life of this
site** — they appear only as the player at the head of an essay, which is a
citation, not a stanza. The music room (`/blog?view=music`, built 2026-08-11) is
the first surface a song has ever had, and it files them by **feeling**.

**The diagnosis, and it is what makes this a decision rather than a cleanup.**
ADR 0009's mistake was not calling a song a fragment. It was **giving a song a
voice so that it would qualify as one.** Faced with the one fragment type that
contained nothing of its author, it added a field to make music look like text
instead of admitting that music is a different kind of thing. Everything that has
gone wrong since follows from that single move: the subjects field, the suite
stanza, and a body that reads as an obligation to explain the thing you like.

## Decision

**A song carries a feeling, not an idea.** It is filed by what it did to you, it
is never read, and it speaks in someone else's voice or in none. Four parts.

**1 · A song has no subjects.** The field leaves the song editor and `song`
leaves the AI suggester's `kind` enum, so the door closes in the action and not
only in the form. `fragment_subjects` keeps the structural ability to hold a song
link — nothing is dropped and no migration is owed — but nothing offers it. The
one thing that ever came through that door was a genre.

**2 · A song is never a suite stanza.** Music accompanies a constellation two
ways, and both are already built and both are **relations rather than
membership**: `constellations.score_url` (play this through the read) and
`fragments.paired_song_id` (this song goes with this piece). Placement was the
third way and it is the one nobody wanted, because a suite is a sequence read at
the reader's pace and a four-minute song does not queue — which ADR 0009 itself
observed and then gave a stanza to anyway. `song` leaves the constellation
picker, the composer's browser, and `SuiteStanza`; the membership action refuses
it by type, the way `songs.pair` already does.

**3 · The annotation becomes notes, and there are two of them, divided by
audience rather than by length.**

- **A public note** — an observation worth having beside the music, on the rare
  song that leaves one. It stays in `fragments.body`, which already means *the
  words of this fragment* and still does; what changes is what is being asked
  for. It renders **in the music room, behind a popover on the card**, and
  nowhere else. It never leads anything.
- **A private note** — memory-logging, and the thing that has had no home at all:
  where a song came from, what week it belongs to, what to listen for at 2:41. It
  lives in a new **`fragment_private_notes`** table, gated on `is_admin()` for
  every operation, with no `anon` or `authenticated` policy of any kind.

**"Why this one" is retired as a name because the name was the bug.** It asked
for a justification, and a justification is the one thing this site's aesthetic
forbids here. A note asks for an observation, which is what the only person ever
to fill the field actually wrote.

⚠ **The private half is a separate table because privacy has to be structural.**
`fragments` is read with `select *` by the public site, the export and the
backup, so a "private" column on that row is public the moment anyone looks. A
column-level `GRANT` would work and would make every existing `select *` a
future outage. **The rule this encodes: a field whose secrecy depends on nobody
selecting it is not private, and belongs in a table whose policy says so.**

**4 · A song's public surface is the music room, and it is filed there by
feeling.** This is what replaces ADR 0009's third role rather than merely
deleting it. The question that role existed to answer — *why not just share a
playlist?* — still has an answer, and it is a better one than the annotation
ever was: **a playlist is one label applied to many songs, and this is many
labels applied to one song.** There is nowhere in that product to say *this track
is redemptive and regretful at once*. The "why" is now **placement**, which costs
a word instead of a paragraph and lets the music do the talking.

## Consequences

**The corpus needs no migration to comply with three of the four parts.** Zero
songs carry a subject, zero are placed, and the single existing annotation
becomes the public note **by doing nothing at all**, because it was always a
note. Only the private table is new. That is what tells you these rulings
describe the corpus rather than reshape it.

**`fragments` still holds songs, and [ADR 0003](0003-fragments-single-table.md)
stands.** Splitting `songs` into its own table is the move this record most
looks like it should make, and it is refused: 0003 was a decision about
**storage**, not a claim about kind. The self-FK in ADR 0011 works precisely
because both ends are fragments; soft delete, trash, search, versioning and the
`person_fragments` edge all come free. A separate table buys a better noun and
costs a polymorphic person edge, a rewritten FK, a second trash and a second
search. **What was wrong was the treatment, not the address** — and this ADR is
where that distinction is now recorded, since the schema will keep implying
otherwise.

**0003's "regardless of type" is narrowed for exactly one type.** Its Context
reads *"the Sky needs a single fragment to belong to many constellations
regardless of type"*; a song may not. The uniformity that argument was defending
is untouched everywhere else.

**One editor for a song, reachable from several lists.** The split this record
closes was not conceptual, it was two editors for one object divided by *field*:
`/admin/listening` owned feelings and could not edit the metadata, while the
Fragment Manager's sheet owned the metadata and knew nothing about feelings.
Michael: *"this division is really uncomfortable for me, and I don't think it's a
clean implementation."* One sheet now owns the whole song — player, link,
metadata, feelings, both notes — and the Fragment Manager keeps **listing** songs
because search, trash and bulk publish are corpus-wide and should not fork.

**A song enters the corpus through Listening, and only through there.** "Song"
leaves both Add ▾ menus. The exception is deliberate and already shipped: the
writing sheet's Music tab creates one from a pasted link, through the same
`saveSong`, because that is a **second door and not a second write path**.

**Accepted downside — a public note has one surface, and a song with no feelings
has none.** The music room lists only songs carrying at least one feeling, so a
note on an untagged song is written and never shown. That is the same display
rule that governs the room already, and the fix is to tag the song.

**Accepted downside — two notes is one more decision per song than one.** The
mitigation is that the question is never *which field is this?* but *do I want
anyone to see this?*, which is a question with an obvious answer at the moment of
writing. If public notes go the way "Why this one" did, the field to delete is
the public one, and this record will have been half right.

**The AI boundary is unchanged and is worth restating here**, because this is
where a future reader will look for it. Subjects are suggested by a model
([ADR 0007](0007-ai-subject-tagging.md)) because a subject is what a piece is
*about* and that is legible from the text. **A feeling is not a property of the
song — it is what happened in Michael**, so there is no `suggestFeelings`, and
nothing may propose one: not as a first pass, not as suggestions to accept or
reject, not to narrow a list. Now that songs have no subjects, **no part of a
song is machine-taggable at all**, which is a cleaner line than the one it
replaces.

## Alternatives

- **Rename "Why this one" to "Notes" and stop there** — one field, public,
  exactly as it is. The cheapest answer and the one this started as. Rejected
  because it leaves the memory-logging half homeless, and that half is the one
  Michael described wanting: a private note is not a smaller public note, it is a
  different document with a different reader.
- **One notes field, private only.** Argued for at length, and lost to Michael's
  call. The case was that a public note re-creates the annotation under a
  friendlier name and will be empty 47 times in 48; the case against it is that
  *"it'd be worthwhile to have notes about a particular piece at times, and that
  should be optionally shown to the public"* — and that the objection to "why this
  one" was never about the reader seeing words, it was about being asked to
  justify. The measurement that would settle it does not exist yet, which is why
  this record is Proposed.
- **Both notes in `fragments`, with the private one on a revoked column.**
  Postgres supports it (`grant select (…)`), and it is the smallest schema. It
  turns every existing `select *` on `fragments` — the public site, the export,
  the nightly backup — into a query that errors for `anon`, and makes every
  future one a trap. Rejected: see the rule above.
- **Split `songs` into its own table.** The most honest reading of *"are songs
  really fragments?"*, and genuinely tempting. Rejected on cost, above.
- **Keep the suite stanza dormant rather than deleting it.** It is built,
  commented, and harmless. Rejected because dead code that renders is not
  harmless — it is a standing invitation to a future session to "fix" the missing
  picker that would feed it, and the argument for its absence would live only in
  this file. Deleting it makes the decision structural. `git log` keeps the
  implementation if the decision ever reverses.
- **Leave the subjects field on songs as optional.** Rejected for the reason the
  field failed the first time: an optional field on a form is a suggestion that
  it should be filled, and the only thing that arrived through it was `jazz`.
  Optionality is not neutrality.
