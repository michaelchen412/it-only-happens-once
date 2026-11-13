-- ⚠ NOT APPLIED — DEFERRED (2026-11-13, Michael: "not important right now").
-- Its precondition is met: the code reading `music_url` has served production
-- since 2026-11-13 and nothing reads the columns below. Apply it from the
-- Supabase SQL editor whenever — the MCP `apply_migration` declines any
-- destructive statement here — and then rename this file to the version
-- `list_migrations` reports, since its timestamp currently sorts before the
-- two migrations that were applied ahead of it. Tracked in docs/plans/README.md.
--
-- ══════════════════════════════════════════════════════════════════════════
-- Phase 2 of 2: contract. The old shape comes out.
--
-- ⚠ APPLY ONLY AFTER THE CODE THAT READS `music_url` IS SERVING IN
-- PRODUCTION. Until then the deployed site selects `paired_song` and
-- `paired_playlist_url` on every essay read, and dropping them breaks every
-- essay page. See `an_essay_carries_its_music_as_a_link` for why this is two
-- files.
--
-- What goes, and what goes with it:
--   · `fragments.paired_song_id` — and with the column, its foreign key to
--     `songs` and `fragments_paired_song_id_idx`
--   · `fragments.paired_playlist_url`
--   · `songs` — and with the table, its four RLS policies. Nothing else in the
--     schema references it: no view, function, trigger or other foreign key
--     (checked 2026-11-13).
--
-- Nothing of value is lost. A song row held a title, an artist and the URL;
-- the URL is on the essay now, and the title and artist rendered nowhere a
-- reader could see — the paired player prints no caption, and they reached
-- only the iframe's accessible name and a site-search result that pointed at a
-- room the song was not in.
-- ══════════════════════════════════════════════════════════════════════════

-- ⚠ THE GUARD. Phase 1 copied every pairing; the old Music tab kept writing
-- `paired_song_id` until the new code deployed. If anything was paired in that
-- window and never reached `music_url`, refuse — re-run phase 1's backfill for
-- those rows first. Only this direction is checkable: the new code never
-- writes the old columns, so a `music_url` with no old pairing beside it is
-- correct, not drift.
do $$
declare
  missed int;
begin
  select count(*) into missed
  from public.fragments
  where (paired_song_id is not null or paired_playlist_url is not null)
    and music_url is null;
  if missed > 0 then
    raise exception '% essay(s) have a pairing that music_url does not carry — nothing was dropped', missed;
  end if;
end $$;

alter table public.fragments drop column paired_song_id;

alter table public.fragments drop column paired_playlist_url;

drop table public.songs;
