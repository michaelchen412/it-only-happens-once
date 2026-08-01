-- ============================================================================
-- Paired media becomes a relation: an essay may point at a song fragment.
--
-- 50 of the 51 imported essays carry `details.media = { provider, url }` from
-- Squarespace — a decade-long habit of pairing one track to one piece, brought
-- across and then rendered nowhere for the whole life of this site (ADR-0009
-- names it as the thing that settled what songs are for).
--
-- ADR-0009 deliberately left open whether such a pairing stays an attribute of
-- the essay or becomes a fragment row of its own. This migration is the answer:
-- A ROW. The pairing is a foreign key, and the song is a first-class fragment
-- that can carry subjects, be placed in a constellation, and — the point of the
-- whole exercise — eventually earn an annotation saying why.
--
-- WHY THIS DOESN'T FLOOD THE SITE, which was the obvious objection: a published
-- `song` fragment surfaces publicly ONLY as a stanza inside a constellation
-- suite. /blog has exactly two views, Writing and Quotes, and a song has no
-- permalink of its own. So a promoted pairing is invisible until it is placed,
-- which is the correct default for 45 songs nobody has written a word about.
--
-- ON DELETE SET NULL, not cascade. Deleting a song must blank the pairing, not
-- take the essay with it. This is the single most important word in the file.
--
-- RLS NEEDS NO CHANGE, and that is worth stating because it looks like an
-- omission. A PostgREST embed applies the target table's own policies, so an
-- essay whose paired song is still a draft simply gets null back for the embed
-- when read by anon. The pairing cannot leak an unpublished song.
--
-- WHAT THIS DOES NOT ENFORCE: that the target is `type = 'song'`. A composite
-- FK on (id, type) would need a generated column to hold the constant 'song',
-- and a generated column cannot be set to null — which is exactly what ON
-- DELETE SET NULL must do. The trade is deliberate: keep the delete semantics,
-- enforce the type in `pairSong` (src/actions/fragments.ts), where the error
-- message can be a sentence rather than a constraint name.
-- ============================================================================

alter table public.fragments
  add column if not exists paired_song_id uuid
    references public.fragments (id) on delete set null;

comment on column public.fragments.paired_song_id is
  'The song fragment this essay is paired with (ADR-0009 "paired media"). Set by pairSong, which enforces type = ''song''. Null for everything else.';

-- An essay cannot be paired with itself. Cheap, and the only self-reference
-- mistake this shape allows.
alter table public.fragments
  drop constraint if exists fragments_paired_song_not_self;
alter table public.fragments
  add constraint fragments_paired_song_not_self
    check (paired_song_id is null or paired_song_id <> id);

-- The essay→song direction is the FK and needs no help. This index serves the
-- REVERSE question — "is this song paired to anything?" — which is what a
-- delete has to ask, and what a future /listening surface would ask constantly.
create index if not exists fragments_paired_song_id_idx
  on public.fragments (paired_song_id)
  where paired_song_id is not null;
