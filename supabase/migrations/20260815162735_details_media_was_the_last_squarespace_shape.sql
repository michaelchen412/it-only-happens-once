-- Plan 40 §1b, second half — the legacy paired-media shape comes out.
--
-- `details.media` is `{ provider, url }`, brought over by the Squarespace import
-- and never written by the app since. It sat on 50 published essays in two very
-- different roles:
--
--   · 48 of them ALSO have a real `paired_song_id` pointing at the same track,
--     so their copy was pure duplication — and worse than idle, because
--     `pairedMediaOf`'s fallback was one missed `return` away from playing a
--     song RLS had just hidden. That specific bug happened once and is pinned by
--     paired-media.test.ts.
--   · 2 of them had no song row and could not have one — ADR 0009 forbids a song
--     fragment from citing a PLAYLIST — so the fallback was the only thing
--     rendering their player.
--
-- Those two moved to `paired_playlist_url` in the previous migration, the code
-- now reads that column, and both essays were confirmed still playing before
-- this ran. So the shape has no readers left in the app and no rows that depend
-- on it.
--
-- ⚠ THE KEY IS DROPPED, THE COLUMN IS NOT. `details` is shared by every fragment
-- type and still carries a song's Spotify metadata; only the `media` key goes.
update public.fragments
set details = details - 'media'
where details ? 'media';
