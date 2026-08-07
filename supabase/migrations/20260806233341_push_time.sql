-- When the tripwire is allowed to speak (21 · Phase 3, ADR-0019).
--
-- One column, arriving with the piece that needs it — which is the rule the
-- `settings` table states in its own header: *"More columns arrive with the
-- pieces that need them … one per piece, not speculatively now."* Phase 2
-- deliberately did NOT add this, because Phase 2 had nothing to read it with.
--
-- ── WHY A WALL CLOCK AND NOT A `timestamptz` ────────────────────────────────
--
-- "Ten in the morning" is a fact about Michael's morning, not an instant. The
-- same argument `tasks.due_time` makes, for the same reason: a stored instant
-- would silently move when `settings.home_timezone` changes, so the hour he
-- chose would drift the moment he travelled. The zone is applied at read time,
-- in the sender, against `home_timezone` — never baked in here.
alter table public.settings
  add column push_time time not null default '10:00';

comment on column public.settings.push_time is
  'Wall clock in home_timezone, after which a skipped check-in may trigger the daily push. Never an instant.';

-- ⚠ WHY 10:00 AND NOT 07:00, WHICH IS WHAT A "MORNING REMINDER" WOULD BE.
--
-- This is not a reminder. It is a TRIPWIRE, and the difference is the whole
-- design (ADR-0019). Michael, 2026-08-06: *"I don't need a reminder necessarily
-- to do my sleep check-in … the notification telling me 'Hey, do your sleep
-- check-in' is noise because I need to already have that ingrained within me."*
--
-- So the hour is chosen to be LATE ENOUGH THAT A NORMAL MORNING HAS ALREADY
-- ANSWERED. At 07:00 the check-in is unanswered on almost every day, including
-- every good one, and the push would fire ~365 times a year — which is the
-- daily ping you learn to swipe away, and therefore the destruction of the
-- signal. At 10:00 it fires on the days the habit actually broke.
--
-- ⚠ IF IT STARTS SPEAKING MOST DAYS, THE HOUR IS WRONG, NOT THE FEATURE.
-- `push_day_claims` is the evidence: one row per day it spoke, and nothing
-- written on a day that stayed quiet. Count the rows before changing anything.

-- NO `push_enabled` FLAG, AND THAT IS DELIBERATE.
--
-- The off switch already exists and is stronger: `push.forget` deletes the
-- device's row, and the sender cannot reach an endpoint it does not have, so
-- turning off cannot fail open. A second global boolean would be a way to be
-- "subscribed but muted" — a state with no visible difference from off, two
-- places to look when nothing arrives, and a new way for the feature to be
-- silently broken. Subscriptions ARE the switch. If a temporary global mute
-- ever earns itself, it can be added then, by someone who wants it.
