-- Home is New York, and has been. Correcting the setting AND the rows it wrote.
--
-- `settings.home_timezone` shipped as `America/Los_Angeles` on 2026-08-02 —
-- the column default, never changed. The device says `America/New_York` and so
-- does the Google calendar (see the note in src/lib/hq/mirror.ts), so Today has
-- been showing the travel note from `deviceZoneNote()` every morning. That
-- function was working exactly as designed: it refuses to switch zones on the
-- browser's say-so, because a silent switch mid-trip corrupts the sleep series
-- precisely at the boundary. This was never travel. The setting was wrong.
--
-- ⚠ THE UPDATE ALONE WOULD CORRUPT THE SLEEP ROWS, which is why this file is
-- not one line. `bed_at` and `woke_at` are INSTANTS, computed by
-- `zonedTimeToUtc()` from wall-clock times read in the configured zone. A row
-- saved as "in bed at 3:00" is stored as 10:00Z because 10:00Z *is* 03:00 in
-- Los Angeles. Change the setting on its own and `utcToZonedTime()` reads that
-- same instant back in New York as 6:00 AM — every night ever logged jumps
-- forward three hours, silently, and the series is wrong at the seam forever.
--
-- So the instants are rewritten to preserve the WALL CLOCK, which is the thing
-- that was actually true: `(ts at time zone <old>) at time zone <new>` strips
-- the instant to the local reading it had in Los Angeles, then re-anchors that
-- reading in New York. Named zones on both sides, never `- interval '3 hours'`
-- — the gap is 3h today and would be 3h for these three August rows, but it is
-- not 3h across every DST boundary the two zones do not share, and a hard-coded
-- offset is the exact mistake `home_timezone` exists to make impossible.
--
-- `log_date` is deliberately NOT touched. It is the date you woke up on, it was
-- correct in the old zone for all three rows (each bed/wake pair still brackets
-- the same morning after the shift), and re-deriving it from an instant is
-- precisely what the column exists to stop anyone doing.
--
-- Nothing else in the schema needs this. `zonedTimeToUtc()` has exactly one
-- caller — src/actions/checkin.ts — so `daily_checkins` is the only table
-- holding wall-clock-derived instants. `external_events.starts_on` was bucketed
-- in the old zone at ingest, but it is a one-way mirror (ADR-0014): a full
-- resync re-derives it from Google, so there is nothing to migrate here.

-- The order matters only for readability; both statements are in one
-- transaction, so no reader ever sees the setting changed and the rows not.
update public.daily_checkins
set
  bed_at = (bed_at at time zone 'America/Los_Angeles') at time zone 'America/New_York',
  woke_at = (woke_at at time zone 'America/Los_Angeles') at time zone 'America/New_York'
where bed_at is not null
  or woke_at is not null;

update public.settings
set home_timezone = 'America/New_York'
where home_timezone = 'America/Los_Angeles';

-- The default follows the fact. It only applies to a row inserted into a fresh
-- environment, but a default that disagrees with the one real row is a trap
-- laid for whoever restores from scratch. `FALLBACK_TIMEZONE` in
-- src/lib/hq/time.ts is the same value for the same reason.
alter table public.settings
  alter column home_timezone set default 'America/New_York';
