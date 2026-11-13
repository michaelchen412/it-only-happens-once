-- Applied 2026-11-13 and verified straight after:
--
--     essays_with_music   50   (48 song pairings + 2 playlists)
--     songs_matched       48   ← each equals its song's source_url exactly
--     playlists_matched    2
--     missed               0
--     extra                0
--
-- A combined dry run of both phases was not run; this file's own guard (below)
-- is what stood between a miss and a half-done migration.
--
-- ══════════════════════════════════════════════════════════════════════════
-- An essay carries its music as ONE LINK. Phase 1 of 2: expand.
--
-- Michael, 2026-11-13: *"I don't care to browse songs. I just care to link
-- certain ones via a link to certain fragments, and that's it. Or playlists,
-- and it's just dropping a Spotify link and forgetting about it forever."*
--
-- ⚠ THIS REVERSES ONE ARGUMENT IN `a_song_is_not_a_fragment` (2026-08-15),
-- and names it rather than quietly undoing it. That migration kept a song as a
-- ROW because "two songs are paired to TWO essays each — a column on the essay
-- cannot express that." True, and it turned out not to matter: the reuse it
-- protected is two links pasted twice. What the row cost was a whole library
-- (a catalogue to search, a sheet to edit it, dedupe, delete, "Shared by") for
-- an object nobody browses, and that library is where every bug in the
-- 2026-11-13 audit lived — the search queried a column `songs` does not have.
--
-- ⚠ AND IT FOLDS IN `paired_playlist_url`, because a track and a playlist were
-- never different relations here — both are "music that plays above this
-- piece". They were split only because a song ROW may not cite a playlist
-- (ADR 0009). With no row, the rule has nothing to govern. The renderer already
-- embeds either through `embedForUrl`.
--
-- ⚠ TWO PHASES, BECAUSE PUSHING `main` IS A DEPLOY. The live code selects
-- `paired_song:paired_song_id(...)` and `paired_playlist_url` on every essay
-- read; dropping either before the new code serves would break every essay
-- page. So this phase only ADDS — the deployed site never reads `music_url` and
-- is unaffected — and `a_song_was_only_ever_a_link` drops the old shape once
-- the new code is live.
--
-- Between this and the deploy, the live Music tab still writes
-- `paired_song_id`. Don't pair anything in that window; phase 2's guard refuses
-- to run if a pairing exists that `music_url` does not carry.
-- ══════════════════════════════════════════════════════════════════════════

alter table public.fragments add column music_url text;

comment on column public.fragments.music_url is
  'Music that plays above this piece: a Spotify track, album or playlist, or a YouTube video. Stored canonical (no ?si= token). Replaced paired_song_id → songs and paired_playlist_url, 2026-11-13.';

-- The 48 song pairings and the 2 playlists, written from the stored values
-- rather than retyped. `songs.source_url` is already canonical — `saveSong`
-- wrote it through `songRefUrl` — so nothing needs normalising on the way.
update public.fragments f
set music_url = coalesce(
  (select s.source_url from public.songs s where s.id = f.paired_song_id),
  f.paired_playlist_url
)
where f.paired_song_id is not null
   or f.paired_playlist_url is not null;

-- ⚠ CONSTRAINTS NOW, where `paired_playlist_url` declined one. That migration
-- argued "one rule, one place" because `paired_song_id` beside it could not
-- carry a matching check. There is one column now, so the rule can be the
-- schema's rather than the action layer's.
--
-- Writing only: a quote is somebody else's words, and nothing renders a
-- player under one.
alter table public.fragments
  add constraint fragments_music_url_is_writing check (music_url is null or type = 'writing');

-- A URL, not an empty string or a stray paste. Provider rules (track vs
-- playlist vs video, canonical form) stay in `lib/media.ts`, the one parser —
-- a second copy here would drift against it. This only refuses what can never
-- be a link.
alter table public.fragments
  add constraint fragments_music_url_is_a_link check (music_url is null or music_url ~ '^https://\S+$');

-- Every old pairing must have landed. Raising rolls the whole migration back
-- (apply_migration is one transaction), so a miss leaves nothing half-done.
do $$
declare
  missed int;
begin
  select count(*) into missed
  from public.fragments
  where (paired_song_id is not null or paired_playlist_url is not null)
    and music_url is null;
  if missed > 0 then
    raise exception '% pairing(s) did not reach music_url — nothing was changed', missed;
  end if;
end $$;
