# 0044 — An essay's music is a link on the essay

Status: **Accepted** *(2026-11-13)*
Date: 2026-11-13

Supersedes [ADR 0011](0011-paired-media-is-a-fragment.md)'s decision that *a
paired song is a row, not a column*, and the song-sheet half of
[ADR 0034](0034-a-relation-may-be-edited-from-either-end.md) (the second door
onto a pairing). [ADR 0009](0009-music-three-roles.md)'s **paired** role
survives — an essay may still carry music that plays above it — and so does its
**score** role. What changes is what the paired music *is*.

## Context

Music reached an essay through a chain of objects, and each link was the
residue of a feature that had since been removed:

- **2026-07-31** — the 48 imported pairings were promoted to `song` *fragments*,
  so an essay pointed at one through `paired_song_id` (ADR 0011). A fragment, so
  a song could carry an annotation — ADR 0009's "why this one".
- **2026-08-11** — the annotation became two notes and the feelings vocabulary
  (ADR 0031); a song sheet was built to edit them; and a second door was added
  so a pairing could be made from the song's side while it played (ADR 0034).
- **2026-08-15** — feelings, notes and the listening room were retired
  (ADR 0035), and songs left `fragments` for a `songs` table of their own: id,
  title, artist, `source_url`. The two essays whose music was a *playlist* got
  `paired_playlist_url`, because a song row could not cite one.

What was left was a table whose title and artist rendered nowhere a reader
could see (the player prints its own), a song sheet no route could open any
more, a pairing picker on the song's side inside it, and a Music tab that was a
search over a catalogue. An audit on 2026-11-13 found that search had been
filtering on a column the table did not have since the day the table was made —
typing anything into it answered with an error — and that nobody had noticed,
because nobody browsed songs. Delete, "Shared by" and re-pointing a link on the
unreachable song sheet were broken as well.

Michael, asked what the Music tab was for: *"I don't care to browse songs. I
just care to link certain ones via a link to certain fragments, and that's it.
Or playlists, and it's just dropping a Spotify link and forgetting about it
forever."*

## Decision

**An essay's music is one link, stored on the essay: `fragments.music_url`.** A
Spotify track, album or playlist, or a YouTube video, in the canonical form
`musicRefUrl` builds. There is no song object — nothing to create, search,
name, dedupe, edit or delete — and the `songs` table, `paired_song_id` and
`paired_playlist_url` are gone.

- **The Music tab is one field.** Pasting saves; the player under it is the
  confirmation; Remove clears it. It applies immediately, like constellation
  membership, because it is not a field of the document's text.
- **Changing it is not an edit of the essay.** The `updated_at` trigger skips an
  update that changed `music_url` and nothing else, because that column is both
  the writing sheet's compare-and-set token and the public "updated" date.
- **One parser.** `parseMusicRef` in `lib/media.ts` decides what an essay may
  carry, and is asked in the browser (for an instant refusal) and on the server
  (as the authority). `media.ts` is pure now that the Spotify Web API lookup —
  which existed only to fill a song's title and artist — is gone.
- **Track and playlist are the same relation.** ADR 0009 kept a playlist off a
  song because a song is one recording; with no song there is no such rule, and
  one column holds either. Episodes, shows and artists are still refused.

## Consequences

- **The bug class goes with the object.** Every defect the audit found lived in
  the library around songs, not in the music. There is no second table for a
  select to drift against, no second row with its own visibility policy, and no
  join for an embed to reject.
- **Two essays that shared a song now each hold the link.** Two songs were paired
  to two essays each. Fixing a dead link means fixing it on both — two places in
  a corpus of ~100 essays.
- **Search no longer finds music by name.** Song titles were searchable; a link
  is not. Nobody searched for a song; if that changes, the title can be
  re-derived from the link (Spotify and YouTube both answer oEmbed), so the
  change is reversible without having kept the table.
- **The song's side has no door.** "What am I going to write about this?",
  asked while the music plays (ADR 0034's second door), has nowhere to be asked.
  It had been unreachable since 2026-08-15 and no song was added in that time.
  The writing sheet's tab keeps playing while you write, which covers the half
  of that habit that was used.
- **No Spotify credential is needed.** `SPOTIFY_CLIENT_ID` /
  `SPOTIFY_CLIENT_SECRET` are read by nothing, and with them goes the Premium
  subscription the Development Mode app required.
- **A link carries no title, so the player's accessible name is
  `Music for «essay title»`** rather than the song's name. The embed announces
  the track itself.

## Alternatives

- **Fix the songs table and keep it.** Correct the search column, give the song
  sheet a door from the Music tab, add an inline player. This was the first
  recommendation of the audit, and it loses on the question it never asked: what
  is the row *for*? A title nobody sees, an artist nobody sees, and reuse across
  two essays. It would have kept a library, and its failure modes, for an object
  nobody browses.
- **Keep `paired_playlist_url` beside a new `music_url` for tracks.** Two
  columns that mean "music that plays above this piece" is the split this
  removes. The only reason the playlist ever had its own column was a rule about
  song rows.
- **Store the title and artist on the essay as cache columns.** Nothing renders
  them, so they would be columns kept in step with an external service for no
  reader.
- **Leave the `updated_at` trigger alone and have the sheet adopt the new token
  after a music write.** Adopting is only safe if nothing else moved the row in
  between, which needs the token before the write as well as after, and an
  autosave already in flight in the same tab races it either way. Not bumping
  the token for a write that is not an edit has no race to lose.
