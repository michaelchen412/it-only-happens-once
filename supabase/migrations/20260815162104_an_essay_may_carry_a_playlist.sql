-- Plan 40 §1b — an essay carries a playlist as a first-class field.
--
-- ⚠ THIS EXISTS TO KILL A LEGACY CODE PATH WITHOUT TAKING A PLAYER AWAY FROM A
-- READER. Two published essays are paired with a Spotify PLAYLIST, and ADR 0009
-- forbids a song fragment from citing one (locked by media.test.ts) — so they
-- have no song row and cannot get one. Their player has only ever been rendered
-- by `pairedMediaOf`'s `details.media` fallback: the last surviving reader of
-- the shape Squarespace brought over.
--
-- The fallback cannot simply be deleted, because those two essays would silently
-- lose their player. So the playlist gets a column of its own and the fallback
-- goes in the same commit that no longer needs it.
--
-- ⚠ NO NEW CONCEPT. A constellation already carries a playlist as its `score_url`
-- — "a playlist to play through the read". This is the same relation one level
-- down: a playlist to play through one piece rather than through a whole
-- composition. Adding it extends ADR 0009 rather than arguing with it.
--
-- ⚠ WRITING ONLY, BY CONVENTION RATHER THAN BY CONSTRAINT. A check constraint
-- would have to read `type`, which is on the same row and so is expressible —
-- but `paired_song_id` next door is unconstrained the same way and the action
-- layer is where both are enforced. One rule, one place; a lone check here
-- would suggest the other column has one too.
alter table public.fragments add column paired_playlist_url text;

comment on column public.fragments.paired_playlist_url is
  'A Spotify playlist to play through this piece (plan 40 §1b). Mutually exclusive with paired_song_id in practice: a song is a recording, this is a set. Replaced the legacy details.media fallback.';

-- The two essays that kept the legacy shape alive, moved onto the column.
-- Written from `details.media` rather than retyped so the URLs cannot drift,
-- and scoped to rows that have no song row — the other 48 carry BOTH a
-- `details.media` copy and a real `paired_song_id`, and must not be touched.
update public.fragments
set paired_playlist_url = details -> 'media' ->> 'url'
where type = 'writing'
  and details ? 'media'
  and paired_song_id is null
  and deleted_at is null
  and details -> 'media' ->> 'url' like '%open.spotify.com/playlist/%';
