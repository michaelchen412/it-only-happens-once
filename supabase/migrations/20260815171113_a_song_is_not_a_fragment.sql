-- Dry-run in a transaction and rolled back before this file was written:
--
--     songs_moved              46   (the 2 test orphans correctly excluded)
--     pairings_intact          48
--     pairings_resolve         48   ← every pairing resolves against `songs`
--     songs_left_in_fragments   0
--     enum_now                 [writing, quote]
--
-- Also checked first: songs carry 0 private notes, 0 versions, 0 person links,
-- 0 subjects and 0 constellation placements. Nothing of value cascades with the
-- delete below.
--
-- ══════════════════════════════════════════════════════════════════════════
-- Plan 40 phase 4 — songs leave `fragments` for a table of their own.
--
-- ⚠ THE EXCEPTIONS WERE THE PROOF. A fragment on this site is TEXT, with
-- subjects, placeable in a constellation, readable at a URL. That is what
-- `writing` and `quote` both are, and why they share a manager, a sheet, a card
-- and a taxonomy. A song was none of the four, and each zero had been argued for
-- separately: ADR 0031 took its subjects (a song is not ABOUT anything),
-- ADR 0009 kept it out of constellations (`SuiteItem` is quote | writing), and
-- it never had a page, a feed entry or a list. The site had been carving songs
-- out of fragmenthood one justified exception at a time; this finishes it.
--
-- Michael, 2026-08-14: *"I had my writing and quotes in one place, but the songs
-- felt really out of place. I don't want that to continue being interpreted as
-- the same thing when the role at place is just fundamentally different."*
--
-- ⚠ IT STAYS A ROW RATHER THAN FOLDING INTO THE ESSAY, and the measurement is
-- why: two songs are paired to TWO essays each (48 pairings over 46 songs). A
-- column on the essay cannot express that, which is exactly why `paired_song_id`
-- superseded `details.media` in the first place.
--
-- ⚠ THE IDS ARE CARRIED OVER UNCHANGED, so `paired_song_id` needs no remapping
-- and no lookup table — every existing pairing keeps pointing at the same uuid,
-- which now names a row in `songs` instead of a row in `fragments`.
--
-- WHAT DOES NOT COME WITH IT, because a song has no independent existence:
--   · `slug`   — no page to address; 48 slugs return to the shared namespace
--   · `status` — a song is visible exactly when the essay that pairs it is
--   · `body`   — the public note (ADR 0031), used by 1 song in 48 in 17 days
--   · `details` — `spotify_id` is DERIVED from `source_url`, which data-model.md
--     already calls the one source of truth for id and kind; the rest (album,
--     release_year, thumbnail_url, spotify_album_id, spotify_artist_ids) is real
--     Web-API data that NOTHING renders, because the paired player prints no
--     title by design. Michael: *"the metadata doesn't matter to me. I just want
--     clean data and a non bloated/non-legacy non-workaround schema."* If a
--     surface ever wants an album or a year, `songs.lookup` re-fetches it.
--   · `occurred_at`, subjects, constellations, versions, private notes — all
--     measured at zero for songs before this ran.
--
-- ⚠ TWO ORPHANS ARE DROPPED RATHER THAN MOVED. "Escape From The Underplay" and
-- "Hush" are the only songs no essay points at, both were added by hand during
-- the fortnight the song-creation flow was being built, one is an ALBUM rather
-- than a track, and both still carried the `?si=` tokens the canonical-URL rule
-- forbids. Michael: *"orphans no need to worry about; both were tests."*
--
-- The one public note in the corpus was on "Hush", and is recorded here because
-- it is Michael's writing and the row is going:
--
--   "It's a beautiful song.
--    I love Janek's playing in the beginning; it really sets the tone for the
--    whole piece."
-- ══════════════════════════════════════════════════════════════════════════

create table public.songs (
  -- Not carried from `fragments` by default: every row in the first insert
  -- brings its own id across. New songs are minted by the action layer.
  id uuid primary key default gen_random_uuid(),
  title text not null,
  artist text,
  -- Canonical, no `?si=` — `songRefUrl` in lib/media.ts builds it.
  source_url text not null,
  created_at timestamptz not null default now()
);

alter table public.songs enable row level security;

-- ⚠ SELECT IS OPEN, WHERE A FRAGMENT'S IS GATED ON `status = 'published'`, and
-- the difference is the point of this whole migration: a song has no status
-- because it has no independent visibility. It is reachable only through the
-- essay that pairs it, and THAT row's policy decides whether a reader sees
-- anything. Gating here too would mean a published essay could lose its player
-- to a rule about an object nobody can navigate to.
create policy songs_select_public on public.songs for select to anon, authenticated using (true);

create policy songs_insert_admin on public.songs for insert to authenticated with check ((select is_admin()));

create policy songs_update_admin on public.songs
  for update to authenticated using ((select is_admin())) with check ((select is_admin()));

create policy songs_delete_admin on public.songs for delete to authenticated using ((select is_admin()));

comment on table public.songs is
  'A recording an essay is paired with. Not a fragment — see plan 40 §1a for why the exceptions were the proof.';

-- Only songs an essay actually points at. The two orphans are left behind and
-- fall with the delete below.
insert into public.songs (id, title, artist, source_url, created_at)
select f.id, coalesce(nullif(btrim(f.title), ''), '(untitled)'), f.attribution, f.source_url, f.created_at
from public.fragments f
where f.type = 'song'
  and f.deleted_at is null
  and f.source_url is not null
  and exists (select 1 from public.fragments e where e.paired_song_id = f.id and e.deleted_at is null);

-- The self-reference goes: `paired_song_id` no longer points inside this table,
-- so "a row may not pair itself" has nothing left to say.
alter table public.fragments drop constraint fragments_paired_song_id_fkey;

alter table public.fragments drop constraint fragments_paired_song_not_self;

alter table public.fragments
  add constraint fragments_paired_song_id_fkey
  foreign key (paired_song_id) references public.songs(id) on delete set null;

delete from public.fragments where type = 'song';

-- ⚠ POSTGRES CANNOT DROP AN ENUM VALUE, so the type is rebuilt rather than
-- edited. Safe only because the delete above leaves no row wearing 'song' —
-- the `using` cast would fail outright otherwise, which is the right failure.
alter type public.fragment_type rename to fragment_type_old;

create type public.fragment_type as enum ('writing', 'quote');

alter table public.fragments
  alter column type type public.fragment_type using type::text::public.fragment_type;

drop type public.fragment_type_old;
