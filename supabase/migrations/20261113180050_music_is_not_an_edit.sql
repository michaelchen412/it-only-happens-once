-- ⚠ NOT YET APPLIED — needs Michael's say-so. Must land BEFORE the code that
-- writes `music_url` deploys; see "WHY IT GATES THE DEPLOY" below.
--
-- ══════════════════════════════════════════════════════════════════════════
-- Changing an essay's music is not an edit of the essay.
--
-- `fragments_set_updated_at` bumps `updated_at` on EVERY update. That column
-- is two things at once, and a music write was wrong for both:
--
--   1. THE WRITING SHEET'S CONCURRENCY TOKEN. `saveWriting` only writes
--      `where updated_at = base_updated_at`. The Music tab writes its link
--      straight to the row, so the sheet's token went stale the moment you
--      paired anything — and the next autosave answered CONFLICT and filed a
--      "conflict copy" of an essay nobody else had touched. This was live with
--      `songs.pair` (found 2026-11-13, in the audit that retired the songs
--      table); it was not introduced by `music_url`.
--   2. THE PUBLIC "UPDATED" DATE. Adding music to a 2019 essay stamped it
--      "updated" today, though not one word of it changed.
--
-- ⚠ THE FIX IS HERE AND NOT IN THE SHEET, and the alternative that lost was
-- having `music.set` return the new token for the sheet to adopt. Adopting is
-- only safe if nothing else moved the row in between, which needs the token
-- BEFORE the write as well as after — and an autosave already in flight in the
-- same tab races it either way. Not bumping the token for a write that is not
-- an edit has no race to lose.
--
-- ⚠ NARROW ON PURPOSE: the trigger is skipped only when `music_url` changed
-- AND NOTHING ELSE DID. Every other update bumps exactly as before, including
-- a no-op save — so this changes what one column means and nothing about the
-- rest of the row.
--
-- WHY IT GATES THE DEPLOY: until it lands, every music write from the new
-- Music tab reproduces bug 1.
-- ══════════════════════════════════════════════════════════════════════════

drop trigger fragments_set_updated_at on public.fragments;

create trigger fragments_set_updated_at
  before update on public.fragments
  for each row
  when (
    not (
      old.music_url is distinct from new.music_url
      and (to_jsonb(old) - 'music_url' - 'updated_at') = (to_jsonb(new) - 'music_url' - 'updated_at')
    )
  )
  execute function extensions.moddatetime(updated_at);
